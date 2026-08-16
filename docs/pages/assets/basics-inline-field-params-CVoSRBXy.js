var e=`{
  "formatVersion": 1,
  "seed": 1045,
  "meta": {
    "title": "put a field's shaping numbers on knobs without a wrapper",
    "description": "The two dunes of \`basics-field-params\` with the wrapper deleted. A \`param\` reference inside a field spec may carry its own value — \`{ \\"fn\\": \\"param\\", \\"name\\": \\"amplitude\\", \\"value\\": 18 }\` — so a plain \`transformPoints\` node holds both the expression and the numbers that shape it, where before a subgraph had to exist for the sole purpose of carrying them. The value is SUBSTITUTED before the field is built, exactly as a binding is, so what cooks is the field the literal would have built, cache key included. The key is optional and that is the whole of its safety: omit it and the reference is unbound and refuses to evaluate, with the same error as ever, so a default exists only where somebody wrote one. An outer binding still wins, so wrapping this node in a subgraph that exposes \`amplitude\` overrides the 18 without editing it. Two details are inherited rather than invented: \`frequency\` multiplies the sample position instead of sitting in \`opts.frequency\`, because the noise options are read as plain numbers and cannot hold a spec; and the sample position is offset by a \`nodeSeed\`-derived vector, because a saved noise carries a literal \`opts.seed\` that the graph seed cannot otherwise move.",
    "tags": ["basics", "fields", "params"]
  },
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
      "id": "dunes",
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
                        "octaves": 4,
                        "normalized": true,
                        "position": {
                          "fn": "add",
                          "args": [
                            {
                              "fn": "mul",
                              "args": [
                                { "fn": "position" },
                                { "fn": "param", "name": "frequency", "value": 0.06 }
                              ]
                            },
                            {
                              "fn": "vec",
                              "args": [
                                {"fn": "mul", "args": [{"fn": "sub", "args": [{"fn": "sub", "args": [{"fn": "mul", "args": [{"fn": "mul", "args": [{"fn": "nodeSeed"}, 2.3283064365386963e-10]}, 1021]}, {"fn": "floor", "args": [{"fn": "mul", "args": [{"fn": "mul", "args": [{"fn": "nodeSeed"}, 2.3283064365386963e-10]}, 1021]}]}]}, 0.814971924]}, 32]},
                                {"fn": "mul", "args": [{"fn": "sub", "args": [{"fn": "sub", "args": [{"fn": "mul", "args": [{"fn": "mul", "args": [{"fn": "nodeSeed"}, 2.3283064365386963e-10]}, 3067]}, {"fn": "floor", "args": [{"fn": "mul", "args": [{"fn": "mul", "args": [{"fn": "nodeSeed"}, 2.3283064365386963e-10]}, 3067]}]}]}, 0.14050293]}, 32]},
                                {"fn": "mul", "args": [{"fn": "sub", "args": [{"fn": "sub", "args": [{"fn": "mul", "args": [{"fn": "mul", "args": [{"fn": "nodeSeed"}, 2.3283064365386963e-10]}, 8191]}, {"fn": "floor", "args": [{"fn": "mul", "args": [{"fn": "mul", "args": [{"fn": "nodeSeed"}, 2.3283064365386963e-10]}, 8191]}]}]}, 0.269775391]}, 32]}
                              ]
                            }
                          ]
                        }
                      }
                    },
                    0.5
                  ]
                },
                { "fn": "param", "name": "amplitude", "value": 18 }
              ]
            },
            0
          ]
        }
      }
    }
  ],
  "connections": [{ "from": ["grid", "out"], "to": ["dunes", "in"] }],
  "outputs": [{ "id": "dunes", "pin": "out", "name": "points" }]
}
`;export{e as default};