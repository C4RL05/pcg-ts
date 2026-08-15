var e=`{
  "formatVersion": 1,
  "seed": 1003,
  "meta": {
    "title": "write an attribute from a noise field",
    "description": "A field-capable param takes a field expression instead of a constant: \`setAttribute\`'s \`value\` here is four octaves of Perlin fBm, resolved once per point and stored into a new \`height\` attribute. \`normalized: true\` maps the noise's own raw range onto [0, 1], so no remap wrapper is needed. Noise carries its own \`seed\` inside the spec, so the graph seed cannot reach it directly; what makes this one answer the seed box is the bounded \`nodeSeed\` shift folded into \`opts.position\`, which \`basics-reseed-a-noise\` explains in full. That shift is exactly zero at this graph's own seed, so what renders here is the raw fBm.",
    "tags": ["basics", "fields", "noise", "attributes"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 600,
        "boundsMin": [-30, 0, -30],
        "boundsMax": [30, 0, 30]
      }
    },
    {
      "id": "height",
      "type": "setAttribute",
      "params": {
        "name": "height",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "fbm",
          "base": "perlinNoise",
          "opts": {
            "frequency": 0.02,
            "octaves": 4,
            "gain": 0.5,
            "normalized": true,
            "position": {
              "fn": "add",
              "args": [
                { "fn": "position" },
                {
                  "fn": "vec",
                  "args": [
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }] }] }, 0.358352661] }, 1600] },
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }] }] }, 0.769897461] }, 1600] },
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }] }] }, 0.862182617] }, 1600] }
                  ]
                }
              ]
            }
          }
        }
      }
    }
  ],
  "connections": [{ "from": ["scatter", "out"], "to": ["height", "in"] }],
  "outputs": [{ "id": "height", "pin": "out", "name": "points" }]
}
`;export{e as default};