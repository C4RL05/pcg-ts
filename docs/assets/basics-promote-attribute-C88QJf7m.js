var e=`{\r
  "formatVersion": 1,\r
  "seed": 1015,\r
  "meta": {\r
    "title": "move an attribute between domains",\r
    "description": "Attributes live on domains — point, vertex, primitive, detail — and \`promoteAttribute\` walks the geometry's topology to move one between them. Here a per-point \`height\` becomes a per-triangle \`height\` by averaging the corners, which is what a shader or an exporter that colours faces rather than corners needs. Elements with no contributors keep the attribute default, and string attributes support only mode 'first'.",\r
    "tags": ["basics", "attributes", "domains", "promote"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ground",\r
      "type": "meshPrimitive",\r
      "params": {\r
        "shape": "plane",\r
        "size": [30, 0, 30],\r
        "center": [0, 0, 0],\r
        "orientation": "xz",\r
        "subdivisions": [6, 1, 6]\r
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
          "fn": "perlinNoise",\r
          "opts": {\r
            "frequency": 0.04,\r
            "seed": { "from": "node", "variant": 11 },\r
            "normalized": true,\r
            "position": { "fn": "position" }\r
          }\r
        }\r
      }\r
    },\r
    {\r
      "id": "perFace",\r
      "type": "promoteAttribute",\r
      "params": { "name": "height", "from": "point", "to": "primitive", "mode": "average" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["ground", "out"], "to": ["height", "in"] },\r
    { "from": ["height", "out"], "to": ["perFace", "in"] }\r
  ],\r
  "outputs": [{ "id": "perFace", "pin": "out", "name": "mesh" }]\r
}\r
`;export{e as default};