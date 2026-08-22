var e=`{\r
  "formatVersion": 1,\r
  "seed": 1027,\r
  "meta": {\r
    "title": "cut one cloud into several separate paths",\r
    "description": "With \`groupAttr\` set, \`pointsToPath\` splits the cloud by a whole-number point attribute and emits one polyline per distinct id, in ascending id — four rows here become four independent paths over the same 40 points, not one path zig-zagging between them. The ids come from a \`setAttribute\` of type i32 reading world Z, which is what keeps the grouping a property of the geometry rather than a hardcoded list. Within a group the points are visited in input index order; \`orderAttr\` is the companion knob when that order is not the one the path should follow, and its ties always break to the lower index so the result never depends on the sort.",\r
    "tags": ["basics", "path", "groups", "attributes"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grid",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 10,\r
        "countY": 1,\r
        "countZ": 4,\r
        "spacing": [4, 0, 8],\r
        "origin": [0, 0, 0]\r
      }\r
    },\r
    {\r
      "id": "row",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "row",\r
        "domain": "point",\r
        "type": "i32",\r
        "value": {\r
          "fn": "div",\r
          "args": [{ "fn": "component", "args": [{ "fn": "position" }], "index": 2 }, 8]\r
        }\r
      }\r
    },\r
    {\r
      "id": "paths",\r
      "type": "pointsToPath",\r
      "params": { "groupAttr": "row" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["grid", "out"], "to": ["row", "in"] },\r
    { "from": ["row", "out"], "to": ["paths", "in"] }\r
  ],\r
  "outputs": [{ "id": "paths", "pin": "out", "name": "paths" }]\r
}\r
`;export{e as default};