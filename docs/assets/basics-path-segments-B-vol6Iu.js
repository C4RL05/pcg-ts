var e=`{\r
  "formatVersion": 1,\r
  "seed": 1041,\r
  "meta": {\r
    "title": "draw a curve as solid geometry",\r
    "description": "One oriented asset per segment, which is a different job from a skin. \`sweepProfile\` is what draws a curve as a continuous SURFACE; this node draws it as a run of discrete instanced assets, which is the only way to spell a chain of separate links, a row of sleepers or a string of beads. \`pathSegments\` emits ONE point per polyline segment: positioned at the segment's midpoint, \`rot\` turning the chosen local axis onto the segment, and \`scale\` carrying the segment's length on that axis with \`radius\` on the other two. Spawn a unit cylinder — radius 1, height 1 — on those points and each one lands exactly on its segment, so a whole tangle of cable costs a single draw call. The default axis is \`+y\` rather than orientAlongVector's \`+z\` because the assets this feeds are cylinders and capsules, which three.js builds along Y. \`extend\` adds to both ends, closing the wedge consecutive segments leave on the outside of a bend. The OUTPUT IS A PLAIN CLOUD: the points are midpoints, not the curve, so re-pathing them describes the midpoints.",\r
    "tags": ["basics", "curve", "path", "instancing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "curve",\r
      "type": "subgraph",\r
      "params": { "count": 48, "wander": 0.18, "frequency": 2.5 },\r
      "ref": { "name": "shape/path-meander" }\r
    },\r
    {\r
      "id": "tubes",\r
      "type": "pathSegments",\r
      "params": { "axis": "+y", "radius": 0.35, "extend": 0.35 }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "tube" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["curve", "out"], "to": ["tubes", "in"] },\r
    { "from": ["tubes", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "spawn", "pin": "instances", "name": "instances" },\r
    { "id": "tubes", "pin": "out", "name": "points" }\r
  ]\r
}\r
`;export{e as default};