var e=`{\r
  "formatVersion": 1,\r
  "seed": 1044,\r
  "meta": {\r
    "title": "read a field's shaping numbers from a knob",\r
    "description": "A field expression can read a named value instead of baking one: \`{ \\"fn\\": \\"param\\", \\"name\\": \\"amplitude\\" }\` inside the body's \`translate\` spec takes whatever the wrapping node's \`amplitude\` knob holds, so the two numbers that shape this surface are knobs rather than literals a caller would have to edit the graph to move. Every exposed param binds its name into its body's field scope, which is why both declarations here list no \`targets\` at all — neither writes into an inner param slot, so their type comes from the shape of \`default\` (a number is f32, a 3-number array vec3, a 4-number array vec4). The value is SUBSTITUTED before the field is built, so what cooks is exactly the field the literal would have built, cache key included: turning the knob invalidates precisely what editing the number would have. \`frequency\` multiplies the sample position rather than sitting in \`opts.frequency\`, because that option is read as a plain number and cannot hold a spec — folding the scale into the position is the same move every noise-bearing primitive makes.",\r
    "tags": ["basics", "fields", "subgraph", "params"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "dunes",\r
      "type": "subgraph",\r
      "params": { "amplitude": 20, "frequency": 0.06 },\r
      "subgraph": {\r
        "graph": {\r
          "formatVersion": 1,\r
          "seed": 0,\r
          "nodes": [\r
            {\r
              "id": "grid",\r
              "type": "pointGrid",\r
              "params": {\r
                "countX": 24,\r
                "countZ": 24,\r
                "spacing": [2, 1, 2],\r
                "origin": [-23, 0, -23]\r
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
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "fbm",\r
                              "base": "perlinNoise",\r
                              "opts": {\r
                                "seed": { "from": "node", "variant": 0 },\r
                                "octaves": 4,\r
                                "normalized": true,\r
                                "position": {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    { "fn": "position" },\r
                                    { "fn": "param", "name": "frequency" }\r
                                  ]\r
                                }\r
                              }\r
                            },\r
                            0.5\r
                          ]\r
                        },\r
                        { "fn": "param", "name": "amplitude" }\r
                      ]\r
                    },\r
                    0\r
                  ]\r
                }\r
              }\r
            }\r
          ],\r
          "connections": [{ "from": ["grid", "out"], "to": ["lift", "in"] }],\r
          "outputs": []\r
        },\r
        "inputs": [],\r
        "outputs": [{ "name": "out", "node": "lift", "pin": "out" }],\r
        "params": [\r
          {\r
            "name": "amplitude",\r
            "targets": [],\r
            "description": "Dune height in world units, multiplied into the normalized fBm after it is centred on zero, so 0 gives a flat grid. It writes into no inner param slot: the body's \`translate\` expression reads it by name, which is why its type is derived from the shape of this default rather than from a target's schema.",\r
            "default": 20,\r
            "min": 0,\r
            "max": 50\r
          },\r
          {\r
            "name": "frequency",\r
            "targets": [],\r
            "description": "Scale applied to the noise sample position, so a larger value means smaller dunes. A tunable frequency has to multiply the position like this, because \`opts.frequency\` is read as a plain number and so cannot hold a field expression.",\r
            "default": 0.06,\r
            "min": 0.01,\r
            "max": 0.2\r
          }\r
        ]\r
      }\r
    }\r
  ],\r
  "connections": [],\r
  "outputs": [{ "id": "dunes", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};