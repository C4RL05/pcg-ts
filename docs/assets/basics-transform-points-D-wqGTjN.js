var e=`{\r
  "formatVersion": 1,\r
  "seed": 1010,\r
  "meta": {\r
    "title": "move, turn and size a whole cloud",\r
    "description": "\`transformPoints\` applies P' = R * (scale * P) + translate about the world origin, with \`rotateEuler\` in degrees extrinsic XYZ. It composes with the per-point transform attributes rather than replacing them: \`rot\` becomes R * rot and \`scale\` multiplies componentwise, so transforming a cloud that already carries orientations keeps them. All three params are field-capable, which is how one node can taper or twist a cloud instead of moving it rigidly.",\r
    "tags": ["basics", "transform"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grid",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 10,\r
        "countY": 1,\r
        "countZ": 10,\r
        "spacing": [2, 0, 2],\r
        "origin": [0, 0, 0]\r
      }\r
    },\r
    {\r
      "id": "place",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": [-30, 5, 12],\r
        "rotateEuler": [0, 45, 0],\r
        "scale": [1.5, 1, 1.5]\r
      }\r
    }\r
  ],\r
  "connections": [{ "from": ["grid", "out"], "to": ["place", "in"] }],\r
  "outputs": [{ "id": "place", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};