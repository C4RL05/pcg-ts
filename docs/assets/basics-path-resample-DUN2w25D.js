var e=`{\r
  "formatVersion": 1,\r
  "seed": 1025,\r
  "meta": {\r
    "title": "even out the spacing along a path",\r
    "description": "\`pathResample\` walks each polyline's own arc length and places new points at even steps along it, which is a different operation from thinning a cloud: \`selfPrune\` keeps a subset of the points it was handed, while this creates points that were never there. The ellipse shows why it is needed — \`shape/ring\` spaces its points evenly in ANGLE, and on anything that is not a circle that leaves them bunched at the two ends of the long axis. \`count\` mode places exactly that many samples on every path whatever its length, and on a closed one they divide it without duplicating the start, so every step here comes out equal; \`spacing\` mode steps a fixed number of world units instead, so a longer path simply gets more points. The output is still a path and a closed one comes back closed, but the points are new: they carry \`tangent\` and \`curveU\`. Nothing written on the input's POINTS is carried across — but every PRIMITIVE attribute is, onto both the new points and the resampled path, so a road resampled here stays a road that knows its own width.",\r
    "tags": ["basics", "path", "resample", "spacing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ellipse",\r
      "type": "subgraph",\r
      "params": { "count": 32, "size": [30, 30, 10] },\r
      "ref": { "name": "shape/ring" }\r
    },\r
    {\r
      "id": "path",\r
      "type": "pointsToPath",\r
      "params": { "closed": true }\r
    },\r
    {\r
      "id": "even",\r
      "type": "pathResample",\r
      "params": { "mode": "count", "count": 28 }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["ellipse", "out"], "to": ["path", "in"] },\r
    { "from": ["path", "out"], "to": ["even", "in"] }\r
  ],\r
  "outputs": [{ "id": "even", "pin": "out", "name": "path" }]\r
}\r
`;export{e as default};