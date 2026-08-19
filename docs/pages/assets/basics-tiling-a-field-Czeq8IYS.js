var e=`{\r
  "formatVersion": 1,\r
  "seed": 1056,\r
  "meta": {\r
    "title": "tile a field across the origin",\r
    "description": "TILING IS \`fract\` AND \`mod\`, and this graph is built so the choice inside them is visible rather than asserted. Every bump is the same expression of a TILE-LOCAL coordinate — \`fract(x / 8)\` and \`fract(z / 8)\`, each in [0, 1] — closed at the top, because \`fract(-1e-8)\` rounds up to exactly 1 in f32 — and the checker under them is the TILE INDEX, \`mod(floor(x / 8) + floor(z / 8), 2)\`. The field is unbounded in principle and periodic in fact, which is the whole trick: nothing here stores a tile, and a point 4000 units away costs exactly what a point at the origin costs. The size is one inline \`param\`, and counting where it lands is instructive: FOUR logical uses — two \`fract\` divisions and two \`floor\` divisions — but TEN occurrences in the file, because \`bump\` reads its argument twice and the colour ramp repeats the whole tile index once per channel. One knob moves all ten coherently; spelling them as ten literals means ten edits to retile, and nine chances to leave one behind. That gap between four ideas and ten occurrences is the A3 entry in PLAN.md seen from another angle — nothing yet lets an expression bind a name to a subexpression it uses more than once, so the inline \`param\` is standing in for the \`let\` the grammar does not have. LOOK AT THE ORIGIN. Both fns in this library are FLOORED — \`fract\` is non-negative for every finite input and \`mod\`'s sign follows the DIVISOR — so \`fract(-0.125)\` is 0.875 and \`mod(-1, 2)\` is 1. The tiling therefore crosses x = 0 and z = 0 with no seam at all, and that is the entire reason the choice was made that way. A truncated remainder — JS \`%\`, and WGSL's \`%\` on floats — answers -0.125 and -1 instead, which mirrors every tile in the negative quadrants: the bumps invert into pits and the checker takes a third value the ramp was never given a stop for. It is a defect that cannot be seen in a demo built around the origin's positive corner, and it appears the moment a world grows in the other direction, which is precisely what an unbounded generator does. THE \`floor\` PAIR IS NOT THE SAME OPERATION as the \`fract\` pair, though they read alike: \`fract\` gives the position WITHIN a tile and \`floor\` gives WHICH tile, and together they are the standard decomposition of a coordinate. \`fract(t)\` is exactly \`mod(t, 1)\` — the library pins that equivalence in a test rather than just claiming it — so the two lines here are one idea used twice, once for a continuous value and once for an integer bin. Both are BIT-EXACT on the GPU, which is not a given for \`mod\`: it is four operations, and the CPU rounds each to f32 individually so it runs the device's expansion step for step rather than accumulating in f64 and rounding once. The bump is \`t * (1 - t)\` on each axis, a parabola that is zero at both tile edges and so leaves no ridge where tiles meet — a falloff that did not vanish at the boundary would show the grid as a lattice of cracks.",\r
    "tags": [\r
      "basics",\r
      "fields",\r
      "grid",\r
      "composition"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ground",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 121,\r
        "countZ": 121,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          -24,\r
          0,\r
          -24\r
        ]\r
      }\r
    },\r
    {\r
      "id": "bumps",\r
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
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "fract",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
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
                                {\r
                                  "fn": "param",\r
                                  "name": "tile",\r
                                  "value": 8,\r
                                  "min": 2,\r
                                  "max": 16,\r
                                  "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            1,\r
                            {\r
                              "fn": "fract",\r
                              "args": [\r
                                {\r
                                  "fn": "div",\r
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
                                    {\r
                                      "fn": "param",\r
                                      "name": "tile",\r
                                      "value": 8,\r
                                      "min": 2,\r
                                      "max": 16,\r
                                      "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
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
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "fract",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
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
                                  "fn": "param",\r
                                  "name": "tile",\r
                                  "value": 8,\r
                                  "min": 2,\r
                                  "max": 16,\r
                                  "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            1,\r
                            {\r
                              "fn": "fract",\r
                              "args": [\r
                                {\r
                                  "fn": "div",\r
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
                                      "fn": "param",\r
                                      "name": "tile",\r
                                      "value": 8,\r
                                      "min": 2,\r
                                      "max": 16,\r
                                      "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
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
                88\r
              ]\r
            },\r
            0\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "checker",\r
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
                  "fn": "mod",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "floor",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
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
                                {\r
                                  "fn": "param",\r
                                  "name": "tile",\r
                                  "value": 8,\r
                                  "min": 2,\r
                                  "max": 16,\r
                                  "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "floor",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
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
                                  "fn": "param",\r
                                  "name": "tile",\r
                                  "value": 8,\r
                                  "min": 2,\r
                                  "max": 16,\r
                                  "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    2\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  0.3\r
                ],\r
                [\r
                  1,\r
                  0.94\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "mod",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "floor",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
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
                                {\r
                                  "fn": "param",\r
                                  "name": "tile",\r
                                  "value": 8,\r
                                  "min": 2,\r
                                  "max": 16,\r
                                  "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "floor",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
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
                                  "fn": "param",\r
                                  "name": "tile",\r
                                  "value": 8,\r
                                  "min": 2,\r
                                  "max": 16,\r
                                  "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    2\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  0.44\r
                ],\r
                [\r
                  1,\r
                  0.72\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "mod",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "floor",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
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
                                {\r
                                  "fn": "param",\r
                                  "name": "tile",\r
                                  "value": 8,\r
                                  "min": 2,\r
                                  "max": 16,\r
                                  "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "floor",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
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
                                  "fn": "param",\r
                                  "name": "tile",\r
                                  "value": 8,\r
                                  "min": 2,\r
                                  "max": 16,\r
                                  "description": "Tile edge in world units. Four logical uses — two \`fract\` divisions for the position within a tile, two \`floor\` divisions for which tile — and ten occurrences in the file, all reached by this one knob."\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    2\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  0.62\r
                ],\r
                [\r
                  1,\r
                  0.36\r
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
        "bumps",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "bumps",\r
        "out"\r
      ],\r
      "to": [\r
        "checker",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "checker",\r
      "pin": "out",\r
      "name": "points"\r
    }\r
  ]\r
}\r
`;export{e as default};