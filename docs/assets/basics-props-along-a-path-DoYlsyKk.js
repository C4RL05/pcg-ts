var e=`{\r
  "formatVersion": 1,\r
  "seed": 1028,\r
  "meta": {\r
    "title": "space props evenly along a curve",\r
    "description": "Two primitives cover the whole road-and-lamp-posts shape: \`shape/path-meander\` is a curve SOURCE — an open path that wanders off a straight line by noise and is re-evened by arc length, needing no cloud to start from — and \`place/along-curve\` resamples it and turns every new point to face the way the curve goes, so a \`spacing\` of 6 means a post every 6 world units however long the road turns out to be. The points \`place/along-curve\` emits are new ones carrying \`P\`, \`tangent\`, \`curveU\` and \`rot\`, plus every attribute the curve carried on its PRIMITIVES — a post inherits the road it stands on; when the curve's own POINTS matter instead, \`write/orient-along-path\` orients them in place. Note what varies: the meander carries its noise seed inside a field spec, so \`variant\` is its only re-roll.",\r
    "tags": ["basics", "primitives", "path", "placement"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "road",\r
      "type": "subgraph",\r
      "params": { "count": 40, "size": [80, 1, 60], "wander": 0.5, "frequency": 3 },\r
      "ref": { "name": "shape/path-meander" }\r
    },\r
    {\r
      "id": "posts",\r
      "type": "subgraph",\r
      "params": { "mode": "spacing", "spacing": 6, "axis": "+z" },\r
      "ref": { "name": "place/along-curve" }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "lamp" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["road", "out"], "to": ["posts", "curve"] },\r
    { "from": ["posts", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]\r
}\r
`;export{e as default};