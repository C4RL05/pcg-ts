var e=`{
  "formatVersion": 1,
  "seed": 1011,
  "meta": {
    "title": "turn each point to face a direction",
    "description": "\`orientAlongVector\` writes the standard \`rot\` quaternion so a chosen local axis points along \`direction\`, with \`up\` fixing the roll. \`direction\` is field-capable and resolved per point, so an expression is what makes each point face somewhere different: here \`vec(P.x, 0, P.z)\` points every point radially away from the origin. A zero-length direction leaves that point's rotation alone rather than inventing one.",
    "tags": ["basics", "transform", "rotation", "fields"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 300,
        "boundsMin": [-20, 0, -20],
        "boundsMax": [20, 0, 20]
      }
    },
    {
      "id": "face",
      "type": "orientAlongVector",
      "params": {
        "direction": {
          "fn": "vec",
          "args": [
            { "fn": "component", "args": [{ "fn": "position" }], "index": 0 },
            0,
            { "fn": "component", "args": [{ "fn": "position" }], "index": 2 }
          ]
        },
        "up": [0, 1, 0],
        "axis": "+z"
      }
    }
  ],
  "connections": [{ "from": ["scatter", "out"], "to": ["face", "in"] }],
  "outputs": [{ "id": "face", "pin": "out", "name": "points" }]
}
`;export{e as default};