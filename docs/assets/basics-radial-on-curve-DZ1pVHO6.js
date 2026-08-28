var e=`{
  "formatVersion": 1,
  "seed": 1042,
  "meta": {
    "title": "aim things radially around a curve",
    "description": "\`orientAlongVector\` fixes the roll around a direction with an \`up\` hint, and a CONSTANT up cannot follow a curve that turns over: as the tangent passes through the up vector the roll flips a half turn, and everything placed along the curve snaps round with it. \`place/radial-on-curve\` solves that the only way it can be solved — with a per-point up carried ALONG the curve. \`writeCurveFrame\` seeds a normal perpendicular to the first tangent and transports it point to point by double reflection, the rotation that moves it least at each step, giving \`curveNormal\` and \`curveBinormal\` beside the tangent. The fan is then cos(a) * curveNormal + sin(a) * curveBinormal — the unit vector at angle \`a\` in the plane perpendicular to the tangent — fed back in as \`up\`, which is field-capable for exactly this. \`spread\` is how much of the turn the fan covers, measured from the normal: 0 lines everything up on one side, 1 is a complete fan. Compare \`place/along-curve\`, which aims along the tangent and gives every copy the same roll.",
    "tags": ["basics", "curve", "path", "instancing", "orientation"]
  },
  "nodes": [
    {
      "id": "curve",
      "type": "subgraph",
      "params": { "count": 40, "wander": 0.2, "frequency": 2 },
      "ref": { "name": "shape/path-meander" }
    },
    {
      "id": "fan",
      "type": "subgraph",
      "params": { "count": 120, "spread": 1 },
      "ref": { "name": "place/radial-on-curve" }
    },
    {
      "id": "spawn",
      "type": "spawnInstances",
      "params": { "assetId": "rod" }
    }
  ],
  "connections": [
    { "from": ["curve", "out"], "to": ["fan", "curve"] },
    { "from": ["fan", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [
    { "id": "spawn", "pin": "instances", "name": "instances" },
    { "id": "fan", "pin": "out", "name": "points" }
  ]
}
`;export{e as default};