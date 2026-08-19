var e=`{\r
  "formatVersion": 1,\r
  "seed": 1057,\r
  "meta": {\r
    "title": "a mask, a decay and a compression",\r
    "description": "THREE CURVES, THREE DIFFERENT JOBS \\u2014 not three ways of doing one, which is what makes this the companion to \`basics-field-shaping\` rather than a repeat of it. Each panel reads the same input, the distance from its own centre, and each answers a question the other two answer badly. LEFT, \`smoothstep(2, 8, d)\` inverted: a MASK with stated ends. It is flat at 1 out to d = 2, flat at 0 beyond d = 8, and smooth in between \\u2014 and the flatness at BOTH ends is the whole point, because that is what a linear falloff cannot give you. A \`lerp\` mask creases visibly where it starts and stops; this one does not, which is why it is the shape to reach for when a region has to fade out without announcing its own boundary. The expansion is emitted rather than the WGSL builtin, whose result is undefined when the edges cross, and a zero span is guarded into the step the curve approaches instead of a division by zero. \`ramp\` remains the choice when the knees belong anywhere other than the ends; \`smoothstep\` is the two-edge case worth a name. MIDDLE, \`6 * exp(-0.45 * d)\`: DECAY, and the one curve here that never reaches zero. Every 1.54 units it halves \\u2014 that is \`log(2) / 0.45\`, which is the number to reason with rather than the exponent \\u2014 so across this panel it is small everywhere and zero nowhere, and a threshold rather than the curve is what ends it. Push it far enough and f32 does end it: \`exp\` underflows to exactly 0 below about -103.9, which is the format's floor and not the curve's. This is the honest shape for anything physical that falls off: light, heat, density away from a source. RIGHT, \`2.4 * log(1 + d)\`: COMPRESSION, and the only one that rises. It grows without bound and ever more slowly, which is what turns a quantity spanning orders of magnitude into one a height or a colour can show. The \`1 +\` is insurance rather than a fix for something this cook hits: \`log(0)\` is -Infinity, and no grid point here lands exactly on the centre \\u2014 the nearest sits 0.283 away \\u2014 so the offset is what makes the panel safe to re-spacing rather than what rescues it now. For a base other than e, divide \\u2014 \`div(log(x), log(2))\` \\u2014 since the grammar carries the natural logarithm only. \`exp\` AND \`log\` ARE BUDGETED rather than exact on the GPU \\u2014 with \`distance\`, which carries 1 ULP, they are the three of the seven additions that are: the device has its own transcendentals and the CPU has the host's, and they are simply not the same function. \`smoothstep\` is bit-exact, which was not a given for a five-operation interior \\u2014 it holds only because the CPU rounds each of those operations to f32 in the order the kernel does. \`distance\` supplies the input to all three, and is exactly \`length(sub(a, b))\` by construction.",\r
    "tags": [\r
      "basics",\r
      "fields",\r
      "remap",\r
      "composition"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grid_smoothstep",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 46,\r
        "countZ": 46,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          -28.0,\r
          0,\r
          -9.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_smoothstep",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                6,\r
                {\r
                  "fn": "sub",\r
                  "args": [\r
                    1,\r
                    {\r
                      "fn": "smoothstep",\r
                      "args": [\r
                        2,\r
                        8,\r
                        {\r
                          "fn": "distance",\r
                          "args": [\r
                            {\r
                              "fn": "position"\r
                            },\r
                            {\r
                              "fn": "vec",\r
                              "args": [\r
                                -19,\r
                                0,\r
                                0\r
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
      "id": "grid_exp",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 46,\r
        "countZ": 46,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          -9.0,\r
          0,\r
          -9.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_exp",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                6,\r
                {\r
                  "fn": "exp",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        -0.45,\r
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
      "id": "grid_log",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 46,\r
        "countZ": 46,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          10.0,\r
          0,\r
          -9.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_log",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                2.4,\r
                {\r
                  "fn": "log",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        1,\r
                        {\r
                          "fn": "distance",\r
                          "args": [\r
                            {\r
                              "fn": "position"\r
                            },\r
                            {\r
                              "fn": "vec",\r
                              "args": [\r
                                19,\r
                                0,\r
                                0\r
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
      "id": "chart",\r
      "type": "mergePoints",\r
      "params": {}\r
    }\r
  ],\r
  "connections": [\r
    {\r
      "from": [\r
        "grid_smoothstep",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_smoothstep",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_smoothstep",\r
        "out"\r
      ],\r
      "to": [\r
        "chart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "grid_exp",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_exp",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_exp",\r
        "out"\r
      ],\r
      "to": [\r
        "chart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "grid_log",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_log",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_log",\r
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