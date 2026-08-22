var e=`{
  "formatVersion": 1,
  "seed": 1002,
  "meta": {
    "title": "place points on a regular grid",
    "description": "The deterministic counterpart to scattering: \`pointGrid\` places countX * countY * countZ points stepped by \`spacing\` from \`origin\`, in X-fastest order. There is no randomness at all here — the same params always give the same positions, which makes a grid the right starting cloud when the variation should come from a later node rather than from the source.",
    "tags": ["basics", "grid", "source"]
  },
  "nodes": [
    {
      "id": "grid",
      "type": "pointGrid",
      "params": {
        "countX": 12,
        "countY": 1,
        "countZ": 12,
        "spacing": [4, 0, 4],
        "origin": [-22, 0, -22]
      }
    }
  ],
  "connections": [],
  "outputs": [{ "id": "grid", "pin": "out", "name": "points" }]
}
`;export{e as default};