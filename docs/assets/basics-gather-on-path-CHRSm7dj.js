var e=`{
  "formatVersion": 1,
  "seed": 1043,
  "meta": {
    "title": "gather evenly spaced points into clumps along a curve",
    "description": "\`pathPointAt\` answers the question the library could not: where is this curve at u = 0.37. Resampling steps a whole curve at even intervals, so anything needing one arbitrary parameter had to walk along the tangent and accept leaving the curve wherever it bent. This node moves each point to a parameter along ITS OWN polyline, keeping the points, their attributes and the topology — it slides points along the curve they already sit on, so the path stays the same path and only its parameterization changes. The parameter is field-capable and resolves BEFORE anything moves, which is what lets it read \`curveU\` and express a move relative to where the point already is. \`transform/gather-on-path\` is that idiom packaged: each point slides \`amount\` of the way toward the centre of its own bin, so an even distribution becomes clumps with bare runs between, and because nothing is removed the count is exactly what arrived. It needs \`curveU\` on its input, which pathResample, splineSample and the shape/path-* primitives write and a bare pointsToPath does not.",
    "tags": ["basics", "curve", "path", "spacing"]
  },
  "nodes": [
    {
      "id": "curve",
      "type": "subgraph",
      "params": { "count": 120, "wander": 0.15, "frequency": 3 },
      "ref": { "name": "shape/path-meander" }
    },
    {
      "id": "bundles",
      "type": "subgraph",
      "params": { "bins": 7, "amount": 0.85 },
      "ref": { "name": "transform/gather-on-path" }
    }
  ],
  "connections": [{ "from": ["curve", "out"], "to": ["bundles", "in"] }],
  "outputs": [{ "id": "bundles", "pin": "out", "name": "points" }]
}
`;export{e as default};