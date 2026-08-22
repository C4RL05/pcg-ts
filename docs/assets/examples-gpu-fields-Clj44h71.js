var e=`{\r
  "formatVersion": 1,\r
  "seed": 1,\r
  "meta": {\r
    "title": "a fusable chain, on the CPU or the device",\r
    "description": "Five count-preserving nodes in a strict line, every field param authored as a serialized spec rather than composed in code, so the chain is device-eligible. Switch the cook path in the toolbar: the two device paths agree bit for bit, so the hash holds across them while the time drops as the tail fuses into one resident run. The CPU hash differs, and that is not a defect: GPU floats are not byte-identical to CPU floats. Raise the point count to see why the device path exists.",\r
    "tags": [\r
      "gpu",\r
      "fields",\r
      "attributes",\r
      "performance"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 40000,\r
        "boundsMin": [\r
          -30,\r
          -9,\r
          -30\r
        ],\r
        "boundsMax": [\r
          30,\r
          9,\r
          30\r
        ]\r
      }\r
    },\r
    {\r
      "id": "wobble",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "wobble",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "remap",\r
              "args": [\r
                {\r
                  "fn": "perlinNoise",\r
                  "opts": {\r
                    "seed": { "from": "node", "variant": 11 },\r
                    "frequency": 0.044,\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "normalized": true,\r
                    "position": { "fn": "position" }\r
                  }\r
                },\r
                0,\r
                1,\r
                0,\r
                0.9\r
              ]\r
            },\r
            {\r
              "fn": "remap",\r
              "args": [\r
                {\r
                  "fn": "perlinNoise",\r
                  "opts": {\r
                    "seed": { "from": "node", "variant": 23 },\r
                    "frequency": 0.044,\r
                    "offset": [\r
                      37,\r
                      5,\r
                      -19\r
                    ],\r
                    "normalized": true,\r
                    "position": { "fn": "position" }\r
                  }\r
                },\r
                0,\r
                1,\r
                0,\r
                0.9\r
              ]\r
            },\r
            {\r
              "fn": "remap",\r
              "args": [\r
                {\r
                  "fn": "perlinNoise",\r
                  "opts": {\r
                    "seed": { "from": "node", "variant": 47 },\r
                    "frequency": 0.044,\r
                    "offset": [\r
                      -11,\r
                      61,\r
                      5\r
                    ],\r
                    "normalized": true,\r
                    "position": { "fn": "position" }\r
                  }\r
                },\r
                0,\r
                1,\r
                0,\r
                0.9\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "jitter",\r
      "type": "jitterPoints",\r
      "params": {\r
        "amount": {\r
          "fn": "attribute",\r
          "name": "wobble",\r
          "tupleSize": 3\r
        },\r
        "seed": 7\r
      }\r
    },\r
    {\r
      "id": "place",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "rotateEuler": [\r
          0,\r
          14,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          0.92,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "color",\r
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
                  "fn": "clamp",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "add",\r
                          "args": [\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "fbm",\r
                                  "base": "simplexNoise",\r
                                  "opts": {\r
                                    "seed": { "from": "node", "variant": 0 },\r
                                    "frequency": 0.055,\r
                                    "octaves": 5,\r
                                    "normalized": true,\r
                                    "position": { "fn": "position" }\r
                                  }\r
                                },\r
                                0.62\r
                              ]\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "worleyNoise",\r
                                  "opts": {\r
                                    "seed": { "from": "node", "variant": 1 },\r
                                    "frequency": 0.1155,\r
                                    "output": "f2-f1",\r
                                    "normalized": true,\r
                                    "position": { "fn": "position" }\r
                                  }\r
                                },\r
                                0.3\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "randomField",\r
                              "key": "sparkle"\r
                            },\r
                            0.08\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    0,\r
                    1\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  0.02\r
                ],\r
                [\r
                  0.3,\r
                  0.05\r
                ],\r
                [\r
                  0.55,\r
                  0.1\r
                ],\r
                [\r
                  0.75,\r
                  0.95\r
                ],\r
                [\r
                  1,\r
                  1\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "clamp",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "add",\r
                          "args": [\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "fbm",\r
                                  "base": "simplexNoise",\r
                                  "opts": {\r
                                    "seed": { "from": "node", "variant": 0 },\r
                                    "frequency": 0.055,\r
                                    "octaves": 5,\r
                                    "normalized": true,\r
                                    "position": { "fn": "position" }\r
                                  }\r
                                },\r
                                0.62\r
                              ]\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "worleyNoise",\r
                                  "opts": {\r
                                    "seed": { "from": "node", "variant": 1 },\r
                                    "frequency": 0.1155,\r
                                    "output": "f2-f1",\r
                                    "normalized": true,\r
                                    "position": { "fn": "position" }\r
                                  }\r
                                },\r
                                0.3\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "randomField",\r
                              "key": "sparkle"\r
                            },\r
                            0.08\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    0,\r
                    1\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  0.03\r
                ],\r
                [\r
                  0.3,\r
                  0.25\r
                ],\r
                [\r
                  0.55,\r
                  0.75\r
                ],\r
                [\r
                  0.75,\r
                  0.7\r
                ],\r
                [\r
                  1,\r
                  0.97\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "clamp",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "add",\r
                          "args": [\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "fbm",\r
                                  "base": "simplexNoise",\r
                                  "opts": {\r
                                    "seed": { "from": "node", "variant": 0 },\r
                                    "frequency": 0.055,\r
                                    "octaves": 5,\r
                                    "normalized": true,\r
                                    "position": { "fn": "position" }\r
                                  }\r
                                },\r
                                0.62\r
                              ]\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "worleyNoise",\r
                                  "opts": {\r
                                    "seed": { "from": "node", "variant": 1 },\r
                                    "frequency": 0.1155,\r
                                    "output": "f2-f1",\r
                                    "normalized": true,\r
                                    "position": { "fn": "position" }\r
                                  }\r
                                },\r
                                0.3\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "randomField",\r
                              "key": "sparkle"\r
                            },\r
                            0.08\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    0,\r
                    1\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  0.1\r
                ],\r
                [\r
                  0.3,\r
                  0.55\r
                ],\r
                [\r
                  0.55,\r
                  0.8\r
                ],\r
                [\r
                  0.75,\r
                  0.25\r
                ],\r
                [\r
                  1,\r
                  0.9\r
                ]\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "psize",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "psize",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "add",\r
          "args": [\r
            0.35,\r
            {\r
              "fn": "add",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "randomField",\r
                      "key": "size"\r
                    },\r
                    0.5\r
                  ]\r
                },\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "ramp",\r
                      "args": [\r
                        {\r
                          "fn": "worleyNoise",\r
                          "opts": {\r
                            "seed": { "from": "node", "variant": 0 },\r
                            "frequency": 0.077,\r
                            "output": "f1",\r
                            "normalized": true,\r
                            "position": { "fn": "position" }\r
                          }\r
                        }\r
                      ],\r
                      "stops": [\r
                        [\r
                          0,\r
                          1\r
                        ],\r
                        [\r
                          0.4,\r
                          0.35\r
                        ],\r
                        [\r
                          1,\r
                          0.05\r
                        ]\r
                      ]\r
                    },\r
                    1.6\r
                  ]\r
                }\r
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
        "scatter",\r
        "out"\r
      ],\r
      "to": [\r
        "wobble",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wobble",\r
        "out"\r
      ],\r
      "to": [\r
        "jitter",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "jitter",\r
        "out"\r
      ],\r
      "to": [\r
        "place",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "place",\r
        "out"\r
      ],\r
      "to": [\r
        "color",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "color",\r
        "out"\r
      ],\r
      "to": [\r
        "psize",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "psize",\r
      "pin": "out",\r
      "name": "points"\r
    }\r
  ]\r
}\r
`;export{e as default};