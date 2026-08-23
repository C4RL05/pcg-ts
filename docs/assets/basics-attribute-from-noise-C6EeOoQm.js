var e=`{\r
  "formatVersion": 1,\r
  "seed": 1003,\r
  "meta": {\r
    "title": "write an attribute from a noise field",\r
    "description": "A field-capable param takes a field expression instead of a constant: \`setAttribute\`'s \`value\` here is four octaves of Perlin fBm, resolved once per point and stored into a new \`height\` attribute. \`normalized: true\` maps the noise's own raw range onto [0, 1], so no remap wrapper is needed. Noise carries its own \`seed\` inside the spec, so a literal there is a number the graph seed cannot reach; what makes this one answer the seed box is \`\\"seed\\": { \\"from\\": \\"node\\", \\"variant\\": 0 }\`, which derives the noise's seed from the cooking node's own and which \`basics-reseed-a-noise\` explains in full.",\r
    "tags": ["basics", "fields", "noise", "attributes"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 600,\r
        "boundsMin": [-30, 0, -30],\r
        "boundsMax": [30, 0, 30]\r
      }\r
    },\r
    {\r
      "id": "height",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "height",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "fbm",\r
          "base": "perlinNoise",\r
          "opts": {\r
            "seed": { "from": "node", "variant": 0 },\r
            "frequency": 0.02,\r
            "octaves": 4,\r
            "gain": 0.5,\r
            "normalized": true,\r
            "position": { "fn": "position" }\r
          }\r
        }\r
      }\r
    }\r
  ],\r
  "connections": [{ "from": ["scatter", "out"], "to": ["height", "in"] }],\r
  "outputs": [{ "id": "height", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};