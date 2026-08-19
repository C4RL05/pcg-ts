var e=`{\r
  "formatVersion": 1,\r
  "seed": 1052,\r
  "meta": {\r
    "title": "connect a cloud by each point's own reach",\r
    "description": "\`connectPoints\`' \`radius\` as a FIELD: every point carries its own \`reach\`, written here as 1.8 plus the SQUARE of three octaves of Perlin fBm, so the reach spans 1.8 to 8.2 against a median nearest-neighbour distance of 1.7, and the network that comes out is a web of mean degree six with starbursts where the reach spikes \\u2014 the busiest point carries twenty-five edges, and exactly one point of the 220 reaches past 8 at all. Squaring the noise is what makes the pair rule VISIBLE rather than merely true: the long spokes exist only because the big end asked for them, and the small point at the far end of one could never have reached back. THE RULE OF THE PAIR IS max(rA, rB): a pair becomes an edge when it is closer than the LARGER of the two reaches, which is what keeps the relation symmetric. Neither alternative agrees with the same number passed plainly \\u2014 the SMALLER would let a big point be crowded by a small one, and the SUM would double the spacing of an evenly-sized cloud \\u2014 and without a stated rule 'A is near B' and 'B is near A' become two different tests, so an edge would depend on which endpoint asked. It is the same rule \`selfPrune.minDistance\` has always used. \`color\` is written from the same expression as a BRIGHTNESS rather than a hue, purely so the picture shows the reach its edges were drawn from: the viewer reads a point-domain \`color\` onto the line vertices and multiplies it into its own material tint, so a monochrome ramp survives that multiply where a hue would be swallowed by it. Per-point \`scale\` would say nothing here \\u2014 it is read for instance transforms, never for a bare cloud or a network. TWO COSTS travel with a field here and neither is a correctness risk. The candidate scan runs at the WIDEST reach in the cloud, since either endpoint may be the larger, so the edge ceiling is measured on candidates rather than on the edges that survive. And under a partitioned cook the halo is no longer \`radius\` but the GLOBAL MAXIMUM the field can return ANYWHERE in the world \\u2014 a bound to be DERIVED and not measured, because the cloud a cell sees has already been clipped by the halo being sized. Derive it from the expression: a \`clamp\` states the bound outright \\u2014 \`1.8 + 7 * u^2\` with \`u\` clamped to [0, 1] maxes at 8.8 and cannot exceed it, which is why the remap here ends in one. Without the clamp the bound would have to come from the noise's own documented range instead, and a normalized fBm only actually spans about two fifths of its nominal [0, 1] \\u2014 derive the halo from the nominal range and it is safe but loose; measure it from a cook and it is tight and wrong. The derived bound is the number to widen a cell by. Underestimating does not throw; it drops the long edges at the seams only. A non-finite reach is REFUSED here, naming the offending element, where \`pointNeighborhood\`'s radius reads NaN and Infinity as documented values \\u2014 the distinction is which mistake is likelier, and a reach is arithmetic an author writes, so a NaN there is a broken expression rather than a request for no edges. \`degreeAttr\` is what makes the hubs readable downstream: filter on it to find the dead ends, or promote it to size a junction.",\r
    "tags": [\r
      "basics",\r
      "topology",\r
      "fields",\r
      "network",\r
      "halo"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "camps",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 220,\r
        "boundsMin": [\r
          -25,\r
          0,\r
          -25\r
        ],\r
        "boundsMax": [\r
          25,\r
          0,\r
          25\r
        ]\r
      }\r
    },\r
    {\r
      "id": "reach",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "reach",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "add",\r
          "args": [\r
            1.8,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "pow",\r
                  "args": [\r
                    {\r
                      "fn": "clamp",\r
                      "args": [\r
                        {\r
                          "fn": "remap",\r
                          "args": [\r
                            {\r
                              "fn": "fbm",\r
                              "base": "perlinNoise",\r
                              "opts": {\r
                                "seed": {\r
                                  "from": "node",\r
                                  "variant": 0\r
                                },\r
                                "frequency": 0.035,\r
                                "octaves": 3,\r
                                "normalized": true,\r
                                "position": {\r
                                  "fn": "position"\r
                                }\r
                              }\r
                            },\r
                            0.33,\r
                            0.67,\r
                            0,\r
                            1\r
                          ]\r
                        },\r
                        0,\r
                        1\r
                      ]\r
                    },\r
                    2\r
                  ]\r
                },\r
                7\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "tint",\r
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
                  "fn": "attribute",\r
                  "name": "reach"\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  1.8,\r
                  0.3\r
                ],\r
                [\r
                  8.8,\r
                  1.0\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "attribute",\r
                  "name": "reach"\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  1.8,\r
                  0.3\r
                ],\r
                [\r
                  8.8,\r
                  1.0\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "attribute",\r
                  "name": "reach"\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  1.8,\r
                  0.3\r
                ],\r
                [\r
                  8.8,\r
                  1.0\r
                ]\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "net",\r
      "type": "connectPoints",\r
      "params": {\r
        "mode": "radius",\r
        "radius": {\r
          "fn": "attribute",\r
          "name": "reach"\r
        },\r
        "degreeAttr": "degree",\r
        "lengthAttr": "edgeLength"\r
      }\r
    }\r
  ],\r
  "connections": [\r
    {\r
      "from": [\r
        "camps",\r
        "out"\r
      ],\r
      "to": [\r
        "reach",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "reach",\r
        "out"\r
      ],\r
      "to": [\r
        "tint",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "tint",\r
        "out"\r
      ],\r
      "to": [\r
        "net",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "net",\r
      "pin": "out",\r
      "name": "network"\r
    }\r
  ]\r
}\r
`;export{e as default};