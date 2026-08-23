var e=`{\r
  "formatVersion": 1,\r
  "seed": 1008,\r
  "meta": {\r
    "title": "enforce a minimum distance between points",\r
    "description": "\`selfPrune\` scans points in index order and keeps one only when every already-kept point is at least \`minDistance\` away, which turns a clumpy uniform scatter into evenly spaced points for anything with physical extent. Over-scatter deliberately: the output count is emergent, capped by the area divided by minDistance squared, so raising \`count\` past that adds nothing and the real knob is \`minDistance\`.",\r
    "tags": ["basics", "filter", "spacing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 3000,\r
        "boundsMin": [-30, 0, -30],\r
        "boundsMax": [30, 0, 30]\r
      }\r
    },\r
    {\r
      "id": "prune",\r
      "type": "selfPrune",\r
      "params": { "minDistance": 3 }\r
    }\r
  ],\r
  "connections": [{ "from": ["scatter", "out"], "to": ["prune", "in"] }],\r
  "outputs": [{ "id": "prune", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};