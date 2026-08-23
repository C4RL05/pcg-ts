var e=`{\r
  "formatVersion": 1,\r
  "seed": 1011,\r
  "meta": {\r
    "title": "turn each point to face a direction",\r
    "description": "\`orientAlongVector\` writes the standard \`rot\` quaternion so a chosen local axis points along \`direction\`, with \`up\` fixing the roll. \`direction\` is field-capable and resolved per point, so an expression is what makes each point face somewhere different: here \`vec(P.x, 0, P.z)\` points every point radially away from the origin. A zero-length direction leaves that point's rotation alone rather than inventing one.",\r
    "tags": ["basics", "transform", "rotation", "fields"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 300,\r
        "boundsMin": [-20, 0, -20],\r
        "boundsMax": [20, 0, 20]\r
      }\r
    },\r
    {\r
      "id": "face",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": {\r
          "fn": "vec",\r
          "args": [\r
            { "fn": "component", "args": [{ "fn": "position" }], "index": 0 },\r
            0,\r
            { "fn": "component", "args": [{ "fn": "position" }], "index": 2 }\r
          ]\r
        },\r
        "up": [0, 1, 0],\r
        "axis": "+z"\r
      }\r
    }\r
  ],\r
  "connections": [{ "from": ["scatter", "out"], "to": ["face", "in"] }],\r
  "outputs": [{ "id": "face", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};