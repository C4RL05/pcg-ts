var e=`{\r
  "formatVersion": 1,\r
  "seed": 1049,\r
  "meta": {\r
    "title": "let a string attribute drive a field",\r
    "description": "\`attributeIs\` is the only way a field can read a STRING attribute: it resolves to 1 on the elements whose named string attribute equals the literal and 0 on every other one, so \`species\` — itself painted spatially here, because \`setAttribute\`'s string mode takes a field as the selector into \`values\` and this one is a noise — becomes an ordinary scalar field. It is a PREDICATE rather than an index on purpose. A string column stores positions in a per-geometry table that clone, filter and merge rebuild to first-encounter order, so the same value sits at different indices depending on what happened upstream, and in different cells of one partitioned world; the predicate resolves the index against the geometry in hand and never exposes it. The same fact makes a literal that is absent from the table read as all zeros instead of throwing — a cell holding no pines legitimately has no \`pine\`, so a misspelled literal reads as 'nothing matches'. Feeding the 0/1 column to \`lerp\` as the blend factor is what makes the point: both endpoints are continuous fields of \`moisture\` and both are evaluated for every point, and the mask chooses between them. It is a mask, not a branch — swap the \`lerp\` for a \`mul\` and the same column gates instead. The \`remap\` on the selector is only bookkeeping: Perlin's values bunch around the middle of its range, so a bare \`moisture * 3\` would put nearly nine points in ten in the middle band, and stretching the band the noise actually occupies across the three names is what makes the split roughly even. It needs no clamp of its own: \`setAttribute\` floors the selector and clamps it into range, and NaN picks entry 0, so no per-point value can miss.",\r
    "tags": ["basics", "fields", "attributes", "strings"]\r
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
      "id": "moisture",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "moisture",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "perlinNoise",\r
          "opts": {\r
            "seed": { "from": "node", "variant": 0 },\r
            "frequency": 0.032,\r
            "normalized": true,\r
            "position": { "fn": "position" }\r
          }\r
        }\r
      }\r
    },\r
    {\r
      "id": "species",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "species",\r
        "domain": "point",\r
        "type": "string",\r
        "values": ["grass", "birch", "pine"],\r
        "value": { "fn": "remap", "args": [{ "fn": "attribute", "name": "moisture" }, 0.38, 0.67, 0, 3] }\r
      }\r
    },\r
    {\r
      "id": "size",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "lerp",\r
          "args": [\r
            { "fn": "add", "args": [0.3, { "fn": "mul", "args": [{ "fn": "attribute", "name": "moisture" }, 0.6] }] },\r
            { "fn": "add", "args": [0.6, { "fn": "mul", "args": [{ "fn": "attribute", "name": "moisture" }, 2.4] }] },\r
            { "fn": "attributeIs", "name": "species", "value": "pine" }\r
          ]\r
        }\r
      }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["moisture", "in"] },\r
    { "from": ["moisture", "out"], "to": ["species", "in"] },\r
    { "from": ["species", "out"], "to": ["size", "in"] }\r
  ],\r
  "outputs": [{ "id": "size", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};