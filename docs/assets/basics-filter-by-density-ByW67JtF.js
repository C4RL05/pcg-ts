var e=`{\r
  "formatVersion": 1,\r
  "seed": 1007,\r
  "meta": {\r
    "title": "thin a cloud by the density attribute",\r
    "description": "The standard thinning idiom: write the standard \`density\` attribute from a 0..1 noise field, then let \`filterByDensity\` in mode 'probabilistic' keep each point with probability equal to its own density. The result is soft-edged — dense regions stay full, sparse ones fade out, with no visible boundary. Mode 'threshold' on the same input gives the hard-edged version instead.",\r
    "tags": ["basics", "filter", "density", "noise"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 1500,\r
        "boundsMin": [-40, 0, -40],\r
        "boundsMax": [40, 0, 40]\r
      }\r
    },\r
    {\r
      "id": "density",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "density",\r
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
            "normalized": true,\r
            "position": { "fn": "position" }\r
          }\r
        }\r
      }\r
    },\r
    {\r
      "id": "thin",\r
      "type": "filterByDensity",\r
      "params": { "mode": "probabilistic", "seed": 5 }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["density", "in"] },\r
    { "from": ["density", "out"], "to": ["thin", "in"] }\r
  ],\r
  "outputs": [{ "id": "thin", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};