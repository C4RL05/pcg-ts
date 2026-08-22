var e=`{\r
  "formatVersion": 1,\r
  "seed": 1053,\r
  "meta": {\r
    "title": "measure a neighbourhood at each point's own scale",\r
    "description": "\`pointNeighborhood\`'s \`radius\` as a FIELD. The cloud is UNIFORM — a plain scatter, the same density everywhere — and \`reach\` rises left to right from 1.5 to 9 world units, so the count that comes out rises with it. Nothing about the geometry changes across the frame; what changes is the QUESTION each point asks, and that is the whole reading a per-point radius buys: 'how crowded am I, at my own scale', a big point surveying a big neighbourhood and a small one a small neighbourhood in the same cook. NEIGHBOURHOOD IS THEN NOT SYMMETRIC, and that is the point rather than a defect — B lying inside A's radius does not put A inside B's, so two points can disagree about whether they are neighbours and \`countAttr\` counts what each point can SEE. That asymmetry is also why this param needs no pair rule where \`connectPoints.radius\` needs max(rA, rB): an EDGE is one thing shared by two points, so it would depend on which endpoint asked, while a count is one point's own measurement and belongs to it alone. \`reach\` is written with \`remap\` on the x component rather than from noise so the gradient is legible as a gradient — swap in a noise or an authored size and the reading is the same. COST, NOT CORRECTNESS, is what a mixed set of radii affects: the uniform grid is sized from the largest FINITE radius, and a query wider than that scans more cells rather than returning a different answer. An INFINITE radius is legal here and means the whole cloud, falling back to a full scan at O(n) per point — but a graph FILE cannot carry one, because JSON has no infinity and the serializer refuses a non-finite param outright, and a live param patch cannot carry one either: that route gates on the param declaring \`acceptsInfinite\`, and this one does not — in the whole standard library only \`filterByBounds\`' and \`filterPrimitivesByBounds\`' bounds do, so \`setParam\` here answers 'expected a finite number, got null'. What is left is an expression that COMPUTES one at cook time, and \`div(1, 0)\` in this slot duly gives every point a count of 1199 — every other point in the cloud. Under a partitioned cook the halo a cell needs is the GLOBAL MAXIMUM this field can return anywhere in the world, DERIVED rather than measured — the far neighbour that would have set it is precisely the one a clipped cell cannot see. Here the \`clamp\` states it: 9. The remap alone would not, because \`remap\` is UNCLAMPED — the same expression returns 67.75 at x = 500, and 'anywhere in the world' is precisely the range a halo has to survive rather than the range this one cook happens to sample. Underestimating does not throw; it silently misses neighbours, at the seams only. THE LIFT IS THE PICTURE, not part of the idiom: \`nbrCount * 0.25\` raises each point by what it measured, turning a flat plane into a wedge that rises left to right even though the cloud under it is uniform. The wedge is CURVED, and that is the arithmetic being honest: \`reach\` is linear in x, but the disc it sweeps grows with its SQUARE, so a linearly widening question gets a quadratically growing answer: about 4 neighbours across the first six units and about 52 across the last. THE WEDGE TURNS OVER before it gets there, peaking at a band mean of 58 just inside the far edge and falling back — and that is the boundary rather than the arithmetic. A point near the edge sweeps a disc that runs off the end of the cloud, so it counts less than an interior point asking the identical question. It is the same effect a partitioned cook sizes a halo to defeat, visible here because nothing feeds this cloud from outside. Delete that node and the graph is unchanged in everything it teaches — but a plane of 1200 dots four pixels wide cannot show a number, and a corpus graph that cannot be seen fails at its only job. \`color\` carries the same count as a HUE at constant brightness, cool where a point sees little and warm where it sees a lot. A point cloud renders at one uniform size — per-point \`scale\` is read for instance transforms, never for a bare cloud — so colour is the only per-point channel the picture has, and a ramp that darkens instead of shifting hue spends half of it on going invisible. \`basics-neighborhood-count\` is this graph with one radius for the whole cloud.",\r
    "tags": [\r
      "basics",\r
      "attributes",\r
      "neighborhood",\r
      "fields",\r
      "measure"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "cloud",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 1200,\r
        "boundsMin": [\r
          -30,\r
          0,\r
          -30\r
        ],\r
        "boundsMax": [\r
          30,\r
          0,\r
          30\r
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
          "fn": "clamp",\r
          "args": [\r
            {\r
              "fn": "remap",\r
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
                -30,\r
                30,\r
                1.5,\r
                9\r
              ]\r
            },\r
            1.5,\r
            9\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "survey",\r
      "type": "pointNeighborhood",\r
      "params": {\r
        "radius": {\r
          "fn": "attribute",\r
          "name": "reach"\r
        },\r
        "countAttr": "nbrCount"\r
      }\r
    },\r
    {\r
      "id": "lift",\r
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
                  "fn": "attribute",\r
                  "name": "nbrCount"\r
                },\r
                0.25\r
              ]\r
            },\r
            0\r
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
                  "name": "nbrCount"\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  0.3\r
                ],\r
                [\r
                  12,\r
                  0.55\r
                ],\r
                [\r
                  30,\r
                  0.85\r
                ],\r
                [\r
                  85,\r
                  1.0\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "attribute",\r
                  "name": "nbrCount"\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  0.78\r
                ],\r
                [\r
                  12,\r
                  0.8\r
                ],\r
                [\r
                  30,\r
                  0.66\r
                ],\r
                [\r
                  85,\r
                  0.55\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "attribute",\r
                  "name": "nbrCount"\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  0,\r
                  1.0\r
                ],\r
                [\r
                  12,\r
                  0.72\r
                ],\r
                [\r
                  30,\r
                  0.3\r
                ],\r
                [\r
                  85,\r
                  0.14\r
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
        "cloud",\r
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
        "survey",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "survey",\r
        "out"\r
      ],\r
      "to": [\r
        "lift",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "lift",\r
        "out"\r
      ],\r
      "to": [\r
        "tint",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "tint",\r
      "pin": "out",\r
      "name": "points"\r
    }\r
  ]\r
}\r
`;export{e as default};