var e=`{\r
  "formatVersion": 1,\r
  "seed": 1026,\r
  "meta": {\r
    "title": "turn a path's own points to follow it",\r
    "description": "A path built by \`pointsToPath\` carries no \`tangent\` — only a sampler writes one, for the points it created — so \`orientAlongVector\` has nothing to read. \`writeTangents\` supplies it, from the normalized central difference between each point's neighbours along the polyline, which stays smooth through corners and wraps on a closed path. Both nodes keep the points, their attributes and the topology exactly as they arrived, so the \`width\` column written before the path was built is still on the output after the rotation: that is the whole difference from \`place/along-curve\`, which resamples and hands back new points carrying none of it. Run the pair BEFORE any filter — every filter drops topology, and \`writeTangents\` would then find no paths.",\r
    "tags": ["basics", "path", "rotation", "attributes"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ring",\r
      "type": "subgraph",\r
      "params": { "count": 16, "size": [18, 18, 18] },\r
      "ref": { "name": "shape/ring" }\r
    },\r
    {\r
      "id": "width",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "width",\r
        "domain": "point",\r
        "type": "f32",\r
        "value": { "fn": "remap", "args": [{ "fn": "randomField", "key": "width" }, 0, 1, 0.7, 1.5] }\r
      }\r
    },\r
    {\r
      "id": "path",\r
      "type": "pointsToPath",\r
      "params": { "closed": true }\r
    },\r
    {\r
      "id": "tangents",\r
      "type": "writeTangents",\r
      "params": { "name": "tangent" }\r
    },\r
    {\r
      "id": "face",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": { "fn": "attribute", "name": "tangent", "tupleSize": 3 },\r
        "up": [0, 1, 0],\r
        "axis": "+z"\r
      }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["ring", "out"], "to": ["width", "in"] },\r
    { "from": ["width", "out"], "to": ["path", "in"] },\r
    { "from": ["path", "out"], "to": ["tangents", "in"] },\r
    { "from": ["tangents", "out"], "to": ["face", "in"] }\r
  ],\r
  "outputs": [{ "id": "face", "pin": "out", "name": "path" }]\r
}\r
`;export{e as default};