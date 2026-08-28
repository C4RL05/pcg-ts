var e=`{\r
  "formatVersion": 1,\r
  "seed": 4211,\r
  "meta": {\r
    "title": "scatter a lap with as many markers as its own length asks for",\r
    "description": "THE COUNT IS NOT IN THIS FILE. Thirty-five markers land on this loop, and nowhere does the graph say thirty-five: \`pointScatterOnPath\`'s \`count\` is the expression \`0.35 * length\`, resolved against the path's OWN primitive-domain length column, which \`pathResample\` measured at 100.4906. Stretch the loop and the marker count follows it; there is no number to keep in step by hand.\\n\\nWHY THAT NEEDED A NODE. Every other arc-length placer in the library is deterministic-even — \`pathResample\` and \`splineSample\` divide a length into equal steps, \`arcTile\` walks a fixed spacing, \`pathSegments\` emits one point per segment — so a RANDOM population along a curve had to be composed: a source node for the count, a \`setAttribute\` for a random station, then \`transferAlongPath\` sampling \`P\` to pull the cloud onto the curve. That recipe still works and \`basics-stations-on-a-path\` still shows it. What it cannot do is decide HOW MANY.\\n\\nA source node emits points from nothing, so it has no element against which to read a field, and \`fieldCapability.test.ts\` refuses a field-capable param on one for exactly that reason. The question is never what a param decides — \`pathResample.spacing\` decides an output count and is field-capable — it is whether an element exists to read the param PER. A scatter that takes the path as an input has one: the polyline itself. So the count becomes a field, and the population becomes a property of the curve rather than a constant the author maintains beside it.\\n\\nONE COUNT PER POLYLINE, NOT ONE PER CLOUD. The field resolves on the primitive domain, so a geometry carrying four paths gets four independent counts and each path is scattered to its own. The emitted total is always the sum of them, so no path is ever silently skipped.\\n\\nWHAT THE MARKERS DO NOT CARRY. This node writes three things — the position on the curve, the arc position it was drawn at (\`station\` here), and the per-point seed. It does not write a tangent, and that is deliberate: \`writeTangents\`, \`writeCurveFrame\` and \`transferAlongPath\` already answer that question against the same shared arc table, and a fourth node measuring the same curve is how two nodes come to disagree about where the halfway point is. Orient these markers by gathering the tangent, the way the sibling graph does.",\r
    "tags": ["basics", "path", "curve", "closed", "scatter", "field", "instancing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "loop",\r
      "type": "subgraph",\r
      "params": { "count": 64, "size": [16, 16, 16] },\r
      "ref": { "name": "shape/path-loop" }\r
    },\r
    {\r
      "id": "measure",\r
      "type": "pathResample",\r
      "params": { "mode": "count", "count": 128, "lengthAttr": "length" }\r
    },\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterOnPath",\r
      "params": {\r
        "count": {\r
          "fn": "mul",\r
          "args": [0.35, { "fn": "attribute", "name": "length" }]\r
        },\r
        "arcAttr": "station",\r
        "seed": 7\r
      }\r
    },\r
    {\r
      "id": "size",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "tupleSize": 3,\r
        "value": { "fn": "vec", "args": [0.6, 1.8, 0.6] }\r
      }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "marker" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["loop", "out"], "to": ["measure", "in"] },\r
    { "from": ["measure", "out"], "to": ["scatter", "path"] },\r
    { "from": ["scatter", "out"], "to": ["size", "in"] },\r
    { "from": ["size", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "measure", "pin": "out", "name": "lap" },\r
    { "id": "spawn", "pin": "instances", "name": "markers" }\r
  ]\r
}\r
`;export{e as default};