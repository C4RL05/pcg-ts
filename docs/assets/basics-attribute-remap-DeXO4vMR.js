var e=`{\r
  "formatVersion": 1,\r
  "seed": 1004,\r
  "meta": {\r
    "title": "rescale an attribute to a new range",\r
    "description": "\`attributeRemap\` in mode 'fit' measures an attribute's actual minimum and maximum over the domain and stretches them onto [outMin, outMax], which is how a quantity of unknown scale — a raw noise value, a neighbour count, an invented score — becomes something a density or a colour can consume. \`outName\` writes the result beside the original instead of over it, so both columns survive for inspection.",\r
    "tags": ["basics", "attributes", "remap"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 400,\r
        "boundsMin": [-20, 0, -20],\r
        "boundsMax": [20, 0, 20]\r
      }\r
    },\r
    {\r
      "id": "score",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "score",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "perlinNoise",\r
          "opts": {\r
            "frequency": 0.05,\r
            "seed": { "from": "node", "variant": 7 },\r
            "position": { "fn": "position" }\r
          }\r
        }\r
      }\r
    },\r
    {\r
      "id": "fit",\r
      "type": "attributeRemap",\r
      "params": {\r
        "name": "score",\r
        "outName": "scoreFit",\r
        "domain": "point",\r
        "mode": "fit",\r
        "outMin": 0,\r
        "outMax": 1\r
      }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["score", "in"] },\r
    { "from": ["score", "out"], "to": ["fit", "in"] }\r
  ],\r
  "outputs": [{ "id": "fit", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};