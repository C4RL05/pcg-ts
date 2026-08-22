var e=`{
  "formatVersion": 1,
  "seed": 1003,
  "meta": {
    "title": "write an attribute from a noise field",
    "description": "A field-capable param takes a field expression instead of a constant: \`setAttribute\`'s \`value\` here is four octaves of Perlin fBm, resolved once per point and stored into a new \`height\` attribute. \`normalized: true\` maps the noise's own raw range onto [0, 1], so no remap wrapper is needed. Noise carries its own \`seed\` inside the spec, so a literal there is a number the graph seed cannot reach; what makes this one answer the seed box is \`\\"seed\\": { \\"from\\": \\"node\\", \\"variant\\": 0 }\`, which derives the noise's seed from the cooking node's own and which \`basics-reseed-a-noise\` explains in full.",
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
            "seed": { "from": "node", "variant": 0 },
            "frequency": 0.02,
            "octaves": 4,
            "gain": 0.5,
            "normalized": true,
            "position": { "fn": "position" }
          }
        }
      }
    }
  ],
  "connections": [{ "from": ["scatter", "out"], "to": ["height", "in"] }],
  "outputs": [{ "id": "height", "pin": "out", "name": "points" }]
}
`;export{e as default};