var e=`{\r
  "formatVersion": 1,\r
  "seed": 1002,\r
  "meta": {\r
    "title": "place points on a regular grid",\r
    "description": "The deterministic counterpart to scattering: \`pointGrid\` places countX * countY * countZ points stepped by \`spacing\` from \`origin\`, in X-fastest order. There is no randomness at all here — the same params always give the same positions, which makes a grid the right starting cloud when the variation should come from a later node rather than from the source.",\r
    "tags": ["basics", "grid", "source"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grid",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 12,\r
        "countY": 1,\r
        "countZ": 12,\r
        "spacing": [4, 0, 4],\r
        "origin": [-22, 0, -22]\r
      }\r
    }\r
  ],\r
  "connections": [],\r
  "outputs": [{ "id": "grid", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};