var e=`{
  "formatVersion": 1,
  "seed": 1008,
  "meta": {
    "title": "enforce a minimum distance between points",
    "description": "\`selfPrune\` scans points in index order and keeps one only when every already-kept point is at least \`minDistance\` away, which turns a clumpy uniform scatter into evenly spaced points for anything with physical extent. Over-scatter deliberately: the output count is emergent, capped by the area divided by minDistance squared, so raising \`count\` past that adds nothing and the real knob is \`minDistance\`.",
    "tags": ["basics", "filter", "spacing"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 3000,
        "boundsMin": [-30, 0, -30],
        "boundsMax": [30, 0, 30]
      }
    },
    {
      "id": "prune",
      "type": "selfPrune",
      "params": { "minDistance": 3 }
    }
  ],
  "connections": [{ "from": ["scatter", "out"], "to": ["prune", "in"] }],
  "outputs": [{ "id": "prune", "pin": "out", "name": "points" }]
}
`;export{e as default};