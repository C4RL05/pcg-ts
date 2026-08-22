var e=`{
  "formatVersion": 1,
  "seed": 1044,
  "meta": {
    "title": "read a field's shaping numbers from a knob",
    "description": "A field expression can read a named value instead of baking one: \`{ \\"fn\\": \\"param\\", \\"name\\": \\"amplitude\\" }\` inside the body's \`translate\` spec takes whatever the wrapping node's \`amplitude\` knob holds, so the two numbers that shape this surface are knobs rather than literals a caller would have to edit the graph to move. Every exposed param binds its name into its body's field scope, which is why both declarations here list no \`targets\` at all — neither writes into an inner param slot, so their type comes from the shape of \`default\` (a number is f32, a 3-number array vec3, a 4-number array vec4). The value is SUBSTITUTED before the field is built, so what cooks is exactly the field the literal would have built, cache key included: turning the knob invalidates precisely what editing the number would have. \`frequency\` multiplies the sample position rather than sitting in \`opts.frequency\`, because that option is read as a plain number and cannot hold a spec — folding the scale into the position is the same move every noise-bearing primitive makes.",
    "tags": ["basics", "fields", "subgraph", "params"]
  },
  "nodes": [
    {
      "id": "dunes",
      "type": "subgraph",
      "params": { "amplitude": 20, "frequency": 0.06 },
      "subgraph": {
        "graph": {
          "formatVersion": 1,
          "seed": 0,
          "nodes": [
            {
              "id": "grid",
              "type": "pointGrid",
              "params": {
                "countX": 24,
                "countZ": 24,
                "spacing": [2, 1, 2],
                "origin": [-23, 0, -23]
              }
            },
            {
              "id": "lift",
              "type": "transformPoints",
              "params": {
                "translate": {
                  "fn": "vec",
                  "args": [
                    0,
                    {
                      "fn": "mul",
                      "args": [
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "fbm",
                              "base": "perlinNoise",
                              "opts": {
                                "seed": { "from": "node", "variant": 0 },
                                "octaves": 4,
                                "normalized": true,
                                "position": {
                                  "fn": "mul",
                                  "args": [
                                    { "fn": "position" },
                                    { "fn": "param", "name": "frequency" }
                                  ]
                                }
                              }
                            },
                            0.5
                          ]
                        },
                        { "fn": "param", "name": "amplitude" }
                      ]
                    },
                    0
                  ]
                }
              }
            }
          ],
          "connections": [{ "from": ["grid", "out"], "to": ["lift", "in"] }],
          "outputs": []
        },
        "inputs": [],
        "outputs": [{ "name": "out", "node": "lift", "pin": "out" }],
        "params": [
          {
            "name": "amplitude",
            "targets": [],
            "description": "Dune height in world units, multiplied into the normalized fBm after it is centred on zero, so 0 gives a flat grid. It writes into no inner param slot: the body's \`translate\` expression reads it by name, which is why its type is derived from the shape of this default rather than from a target's schema.",
            "default": 20,
            "min": 0,
            "max": 50
          },
          {
            "name": "frequency",
            "targets": [],
            "description": "Scale applied to the noise sample position, so a larger value means smaller dunes. A tunable frequency has to multiply the position like this, because \`opts.frequency\` is read as a plain number and so cannot hold a field expression.",
            "default": 0.06,
            "min": 0.01,
            "max": 0.2
          }
        ]
      }
    }
  ],
  "connections": [],
  "outputs": [{ "id": "dunes", "pin": "out", "name": "points" }]
}
`;export{e as default};