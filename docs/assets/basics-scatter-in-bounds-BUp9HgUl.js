var e=`{\r
  "formatVersion": 1,\r
  "seed": 1001,\r
  "meta": {\r
    "title": "scatter points in a box",\r
    "description": "The smallest complete graph: one source node fills an axis-aligned box with a fixed count of points. Nothing is connected and nothing is filtered, so the output count is exactly \`count\`. Every point already carries the standard attributes (P, rot, scale, density, boundsMin, boundsMax, color, seed) whether the graph writes them or not, which is why later examples can filter on \`density\` without creating it first.",\r
    "tags": ["basics", "scatter", "source"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 500,\r
        "boundsMin": [-25, 0, -25],\r
        "boundsMax": [25, 0, 25]\r
      }\r
    }\r
  ],\r
  "connections": [],\r
  "outputs": [{ "id": "scatter", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};