var e=`{\r
  "formatVersion": 1,\r
  "seed": 1024,\r
  "meta": {\r
    "title": "build a path from a point cloud",\r
    "description": "\`pointsToPath\` is the only way a saved graph can produce polyline geometry: it lays one \`polyline\` primitive over the points it was given, so the points and every attribute on them survive untouched and only topology is added. Visiting order is the input's point order unless \`orderAttr\` names a sort key. \`closed\` appends a trailing vertex referencing the first point — closure is structural, not a flag, so a closed path over 12 points has 13 vertices and there is no duplicated seam point to trip over. \`shape/path-loop\` is exactly this pair of nodes under one name.",\r
    "tags": ["basics", "path", "topology", "source"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ring",\r
      "type": "subgraph",\r
      "params": { "count": 12, "size": [16, 16, 16] },\r
      "ref": { "name": "shape/ring" }\r
    },\r
    {\r
      "id": "path",\r
      "type": "pointsToPath",\r
      "params": { "closed": true }\r
    }\r
  ],\r
  "connections": [{ "from": ["ring", "out"], "to": ["path", "in"] }],\r
  "outputs": [{ "id": "path", "pin": "out", "name": "path" }]\r
}\r
`;export{e as default};