var e=`{\r
  "formatVersion": 1,\r
  "seed": 1062,\r
  "meta": {\r
    "title": "flatten a cloud onto a plane and keep the height it lost",\r
    "description": "\`projectToPlane\` drops every point orthogonally onto the plane through \`origin\` with normal \`normal\`, and with \`keepOffset\` it writes each point's SIGNED pre-projection distance into a \`planeOffset\` attribute before moving it. That pairing is the whole idiom: the geometry becomes a plan view, and the third dimension survives as data rather than being thrown away. Here a relief grid flattens to y = 0 and the height it had drives its colour, so the map still says where the hills were. The ramp is fitted to the relief that actually arrives (about ±1.8 units) rather than to the amplitude the transform asks for: a normalized fBm spans only the middle stretch of its nominal range, so a ramp cut to the nominal number leaves its ends unreachable and the map reads washed out. Signed, so the sign is the side — points below the plane come back negative, and a rule that wants only the high ground reads \`planeOffset > 0\` rather than needing a second node to tell it which way is up.\\n\\nThe params are field-capable and that changes what the node is. As plain vectors they describe ONE plane and the normal must be non-zero. As FIELDS they are read per point, so each point falls onto the plane IT was given: a per-point \`origin\` with a constant normal is an OFFSET along that normal, which is how a stepped or terraced flattening is written; a per-point normal — \`attribute(\\"N\\")\` — puts every point onto its own surface plane instead of onto one shared one. One safety worth knowing before relying on it: where a per-point normal resolves to zero there is no plane to project onto, so that point is left exactly where it stands rather than being collapsed to the origin.",\r
    "tags": ["basics", "project", "plane", "attributes"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "cloud",\r
      "type": "pointGrid",\r
      "params": { "countX": 51, "countZ": 51, "spacing": [0.4, 1, 0.4], "origin": [-10, 0, -10] }\r
    },\r
    {\r
      "id": "relief",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                12,\r
                {\r
                  "fn": "sub",\r
                  "args": [\r
                    {\r
                      "fn": "fbm",\r
                      "base": "perlinNoise",\r
                      "opts": {\r
                        "seed": { "from": "node", "variant": 0 },\r
                        "octaves": 3,\r
                        "normalized": true,\r
                        "position": {\r
                          "fn": "mul",\r
                          "args": [{ "fn": "position" }, 0.08]\r
                        }\r
                      }\r
                    },\r
                    0.5\r
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
      "id": "flat",\r
      "type": "projectToPlane",\r
      "params": { "origin": [0, 0, 0], "normal": [0, 1, 0], "keepOffset": true }\r
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
              "fn": "clamp",\r
              "args": [\r
                {\r
                  "fn": "div",\r
                  "args": [\r
                    { "fn": "add", "args": [{ "fn": "attribute", "name": "planeOffset" }, 1.8] },\r
                    3.6\r
                  ]\r
                },\r
                0,\r
                1\r
              ]\r
            },\r
            0.45,\r
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
                        { "fn": "add", "args": [{ "fn": "attribute", "name": "planeOffset" }, 1.8] },\r
                        3.6\r
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
      }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["cloud", "out"], "to": ["relief", "in"] },\r
    { "from": ["relief", "out"], "to": ["flat", "in"] },\r
    { "from": ["flat", "out"], "to": ["tint", "in"] }\r
  ],\r
  "outputs": [{ "id": "tint", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};