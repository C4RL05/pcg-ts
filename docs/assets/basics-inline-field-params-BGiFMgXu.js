var e=`{\r
  "formatVersion": 1,\r
  "seed": 1045,\r
  "meta": {\r
    "title": "put a field's shaping numbers on knobs without a wrapper",\r
    "description": "The dunes of \`basics-field-params\` with the wrapper deleted. A \`param\` reference inside a field spec may carry its own value — \`{ \\"fn\\": \\"param\\", \\"name\\": \\"amplitude\\", \\"value\\": 24 }\` — so a plain \`transformPoints\` node holds both the expression and the numbers that shape it, where before a subgraph had to exist for the sole purpose of carrying them. The value is SUBSTITUTED before the field is built, exactly as a binding is, so what cooks is the field the literal would have built, cache key included. The key is optional and that is the whole of its safety: omit it and the reference is unbound and refuses to evaluate, with the same error as ever, so a default exists only where somebody wrote one. An outer binding still wins, so wrapping this node in a subgraph that exposes \`amplitude\` overrides the 24 without editing it. Two details are inherited rather than invented: \`frequency\` multiplies the sample position instead of sitting in \`opts.frequency\`, because that option is read as a plain number and cannot hold a spec; and the noise takes its seed from the node, \`{ \\"from\\": \\"node\\", \\"variant\\": 0 }\`, because a literal \`opts.seed\` is a number the graph seed cannot otherwise move. The grid is sized so the knobs are legible rather than merely wired: 20 units of ground at quarter-unit spacing, three octaves, and an amplitude that lands about 10 units of relief. A normalized fBm only spans about two fifths of its nominal range, so a wide grid under a modest amplitude reads as a flat field of dots and the graph fails to show its own effect; the ratio of relief to footprint is also what the viewer's framing reads to pick its elevation angle, so a flat cook is photographed from a flatter angle and hides itself twice.",\r
    "tags": ["basics", "fields", "params"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grid",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 81,\r
        "countZ": 81,\r
        "spacing": [0.25, 1, 0.25],\r
        "origin": [-10, 0, -10]\r
      }\r
    },\r
    {\r
      "id": "dunes",\r
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
                        "octaves": 3,\r
                        "normalized": true,\r
                        "position": {\r
                          "fn": "mul",\r
                          "args": [\r
                            { "fn": "position" },\r
                            { "fn": "param", "name": "frequency", "value": 0.15 }\r
                          ]\r
                        }\r
                      }\r
                    },\r
                    0.5\r
                  ]\r
                },\r
                { "fn": "param", "name": "amplitude", "value": 24 }\r
              ]\r
            },\r
            0\r
          ]\r
        }\r
      }\r
    }\r
  ],\r
  "connections": [{ "from": ["grid", "out"], "to": ["dunes", "in"] }],\r
  "outputs": [{ "id": "dunes", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};