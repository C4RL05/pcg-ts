var e=`{
  "formatVersion": 1,
  "seed": 1062,
  "meta": {
    "title": "flatten a cloud onto a plane and keep the height it lost",
    "description": "\`projectToPlane\` drops every point orthogonally onto the plane through \`origin\` with normal \`normal\`, and with \`keepOffset\` it writes each point's SIGNED pre-projection distance into a \`planeOffset\` attribute before moving it. That pairing is the whole idiom: the geometry becomes a plan view, and the third dimension survives as data rather than being thrown away. Here a relief grid flattens to y = 0 and the height it had drives its colour, so the map still says where the hills were. The ramp is fitted to the relief that actually arrives (about ±1.8 units) rather than to the amplitude the transform asks for: a normalized fBm spans only the middle stretch of its nominal range, so a ramp cut to the nominal number leaves its ends unreachable and the map reads washed out. Signed, so the sign is the side — points below the plane come back negative, and a rule that wants only the high ground reads \`planeOffset > 0\` rather than needing a second node to tell it which way is up.\\n\\nThe params are field-capable and that changes what the node is. As plain vectors they describe ONE plane and the normal must be non-zero. As FIELDS they are read per point, so each point falls onto the plane IT was given: a per-point \`origin\` with a constant normal is an OFFSET along that normal, which is how a stepped or terraced flattening is written; a per-point normal — \`attribute(\\"N\\")\` — puts every point onto its own surface plane instead of onto one shared one. One safety worth knowing before relying on it: where a per-point normal resolves to zero there is no plane to project onto, so that point is left exactly where it stands rather than being collapsed to the origin.",
    "tags": ["basics", "project", "plane", "attributes"]
  },
  "nodes": [
    {
      "id": "cloud",
      "type": "pointGrid",
      "params": { "countX": 51, "countZ": 51, "spacing": [0.4, 1, 0.4], "origin": [-10, 0, -10] }
    },
    {
      "id": "relief",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "vec",
          "args": [
            0,
            {
              "fn": "mul",
              "args": [
                12,
                {
                  "fn": "sub",
                  "args": [
                    {
                      "fn": "fbm",
                      "base": "perlinNoise",
                      "opts": {
                        "seed": { "from": "node", "variant": 0 },
                        "octaves": 3,
                        "normalized": true,
                        "position": {
                          "fn": "mul",
                          "args": [{ "fn": "position" }, 0.08]
                        }
                      }
                    },
                    0.5
                  ]
                }
              ]
            },
            0
          ]
        }
      }
    },
    {
      "id": "flat",
      "type": "projectToPlane",
      "params": { "origin": [0, 0, 0], "normal": [0, 1, 0], "keepOffset": true }
    },
    {
      "id": "tint",
      "type": "setAttribute",
      "params": {
        "name": "color",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            {
              "fn": "clamp",
              "args": [
                {
                  "fn": "div",
                  "args": [
                    { "fn": "add", "args": [{ "fn": "attribute", "name": "planeOffset" }, 1.8] },
                    3.6
                  ]
                },
                0,
                1
              ]
            },
            0.45,
            {
              "fn": "sub",
              "args": [
                1,
                {
                  "fn": "clamp",
                  "args": [
                    {
                      "fn": "div",
                      "args": [
                        { "fn": "add", "args": [{ "fn": "attribute", "name": "planeOffset" }, 1.8] },
                        3.6
                      ]
                    },
                    0,
                    1
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  ],
  "connections": [
    { "from": ["cloud", "out"], "to": ["relief", "in"] },
    { "from": ["relief", "out"], "to": ["flat", "in"] },
    { "from": ["flat", "out"], "to": ["tint", "in"] }
  ],
  "outputs": [{ "id": "tint", "pin": "out", "name": "points" }]
}
`;export{e as default};