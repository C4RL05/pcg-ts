var e=`{
  "formatVersion": 1,
  "seed": 1024,
  "meta": {
    "title": "build a path from a point cloud",
    "description": "\`pointsToPath\` is the only way a saved graph can produce polyline geometry: it lays one \`polyline\` primitive over the points it was given, so the points and every attribute on them survive untouched and only topology is added. Visiting order is the input's point order unless \`orderAttr\` names a sort key. \`closed\` appends a trailing vertex referencing the first point — closure is structural, not a flag, so a closed path over 12 points has 13 vertices and there is no duplicated seam point to trip over. \`shape/path-loop\` is exactly this pair of nodes under one name.",
    "tags": ["basics", "path", "topology", "source"]
  },
  "nodes": [
    {
      "id": "ring",
      "type": "subgraph",
      "params": { "count": 12, "size": [16, 16, 16] },
      "ref": { "name": "shape/ring" }
    },
    {
      "id": "path",
      "type": "pointsToPath",
      "params": { "closed": true }
    }
  ],
  "connections": [{ "from": ["ring", "out"], "to": ["path", "in"] }],
  "outputs": [{ "id": "path", "pin": "out", "name": "path" }]
}
`;export{e as default};