var e=`{
  "formatVersion": 1,
  "seed": 1010,
  "meta": {
    "title": "move, turn and size a whole cloud",
    "description": "\`transformPoints\` applies P' = R * (scale * P) + translate about the world origin, with \`rotateEuler\` in degrees extrinsic XYZ. It composes with the per-point transform attributes rather than replacing them: \`rot\` becomes R * rot and \`scale\` multiplies componentwise, so transforming a cloud that already carries orientations keeps them. All three params are field-capable, which is how one node can taper or twist a cloud instead of moving it rigidly.",
    "tags": ["basics", "transform"]
  },
  "nodes": [
    {
      "id": "grid",
      "type": "pointGrid",
      "params": {
        "countX": 10,
        "countY": 1,
        "countZ": 10,
        "spacing": [2, 0, 2],
        "origin": [0, 0, 0]
      }
    },
    {
      "id": "place",
      "type": "transformPoints",
      "params": {
        "translate": [-30, 5, 12],
        "rotateEuler": [0, 45, 0],
        "scale": [1.5, 1, 1.5]
      }
    }
  ],
  "connections": [{ "from": ["grid", "out"], "to": ["place", "in"] }],
  "outputs": [{ "id": "place", "pin": "out", "name": "points" }]
}
`;export{e as default};