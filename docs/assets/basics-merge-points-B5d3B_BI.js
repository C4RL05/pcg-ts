var e=`{\r
  "formatVersion": 1,\r
  "seed": 1016,\r
  "meta": {\r
    "title": "concatenate two clouds into one",\r
    "description": "\`mergePoints\` has a multi input: every connected geometry is concatenated in connection order into a single point cloud. The output carries the union of all point attributes — one missing on an input fills with its default over that input's range — and attributes sharing a name must agree on type and tuple size, so a scratch column left on one side can break a merge that used to work. Topology is not carried: the result is points only.",\r
    "tags": ["basics", "merge", "compose"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grid",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 8,\r
        "countY": 1,\r
        "countZ": 8,\r
        "spacing": [4, 0, 4],\r
        "origin": [-14, 0, -14]\r
      }\r
    },\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 120,\r
        "boundsMin": [-14, 0, -14],\r
        "boundsMax": [14, 0, 14]\r
      }\r
    },\r
    { "id": "both", "type": "mergePoints", "params": {} }\r
  ],\r
  "connections": [\r
    { "from": ["grid", "out"], "to": ["both", "in"] },\r
    { "from": ["scatter", "out"], "to": ["both", "in"] }\r
  ],\r
  "outputs": [{ "id": "both", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};