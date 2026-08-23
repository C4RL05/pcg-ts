var e=`{\r
  "formatVersion": 1,\r
  "seed": 1042,\r
  "meta": {\r
    "title": "aim things radially around a curve",\r
    "description": "\`orientAlongVector\` fixes the roll around a direction with an \`up\` hint, and a CONSTANT up cannot follow a curve that turns over: as the tangent passes through the up vector the roll flips a half turn, and everything placed along the curve snaps round with it. \`place/radial-on-curve\` solves that the only way it can be solved — with a per-point up carried ALONG the curve. \`writeCurveFrame\` seeds a normal perpendicular to the first tangent and transports it point to point by double reflection, the rotation that moves it least at each step, giving \`curveNormal\` and \`curveBinormal\` beside the tangent. The fan is then cos(a) * curveNormal + sin(a) * curveBinormal — the unit vector at angle \`a\` in the plane perpendicular to the tangent — fed back in as \`up\`, which is field-capable for exactly this. \`spread\` is how much of the turn the fan covers, measured from the normal: 0 lines everything up on one side, 1 is a complete fan. Compare \`place/along-curve\`, which aims along the tangent and gives every copy the same roll.",\r
    "tags": ["basics", "curve", "path", "instancing", "orientation"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "curve",\r
      "type": "subgraph",\r
      "params": { "count": 40, "wander": 0.2, "frequency": 2 },\r
      "ref": { "name": "shape/path-meander" }\r
    },\r
    {\r
      "id": "fan",\r
      "type": "subgraph",\r
      "params": { "count": 120, "spread": 1 },\r
      "ref": { "name": "place/radial-on-curve" }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "rod" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["curve", "out"], "to": ["fan", "curve"] },\r
    { "from": ["fan", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "spawn", "pin": "instances", "name": "instances" },\r
    { "id": "fan", "pin": "out", "name": "points" }\r
  ]\r
}\r
`;export{e as default};