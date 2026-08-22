var e=`{
  "formatVersion": 1,
  "seed": 1009,
  "meta": {
    "title": "break up a lattice with deterministic jitter",
    "description": "\`jitterPoints\` offsets each point by a random vector drawn per axis from (seed, point index, axis), so the result is reproducible and independent of cook order — the lattice stops reading as a lattice without giving up determinism. \`amount\` is the maximum offset per axis and is field-capable, so the jitter can itself vary across space; here y is left at 0 to keep the cloud flat.",
    "tags": ["basics", "jitter", "determinism"]
  },
  "nodes": [
    {
      "id": "grid",
      "type": "pointGrid",
      "params": {
        "countX": 16,
        "countY": 1,
        "countZ": 16,
        "spacing": [3, 0, 3],
        "origin": [-22.5, 0, -22.5]
      }
    },
    {
      "id": "jitter",
      "type": "jitterPoints",
      "params": { "amount": [1.2, 0, 1.2], "seed": 4 }
    }
  ],
  "connections": [{ "from": ["grid", "out"], "to": ["jitter", "in"] }],
  "outputs": [{ "id": "jitter", "pin": "out", "name": "points" }]
}
`;export{e as default};