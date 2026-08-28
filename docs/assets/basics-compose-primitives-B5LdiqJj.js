var e=`{
  "formatVersion": 1,
  "seed": 1023,
  "meta": {
    "title": "compose several primitives into a scatter",
    "description": "Three primitives and one terminal node build a complete placement pass: scatter with only a token minimum spacing, so the positions read as random — clumps and clearings rather than an even field — cut it to noise-defined regions, give every point one uniform random size, then spawn. Each step is a name from the catalog rather than a hand-built cluster of nodes, which is what keeps the graph readable and its behaviour documented. Note what varies: the scatter and the size write differ per instance, while the noise mask does not — two masks with the same params cut identically unless their \`variant\` differs.",
    "tags": ["basics", "primitives", "composition", "spawn"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "subgraph",
      "params": {
        "count": 700,
        "minDistance": 0.8,
        "boundsMin": [-40, 0, -40],
        "boundsMax": [40, 0, 40]
      },
      "ref": { "name": "fill/scatter-even" }
    },
    {
      "id": "mask",
      "type": "subgraph",
      "params": { "frequency": 0.03, "threshold": 0.45 },
      "ref": { "name": "filter/mask-by-noise" }
    },
    {
      "id": "size",
      "type": "subgraph",
      "params": { "min": 2, "max": 5 },
      "ref": { "name": "write/random-scale" }
    },
    {
      "id": "spawn",
      "type": "spawnInstances",
      "params": { "assetId": "pine" }
    }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["mask", "in"] },
    { "from": ["mask", "out"], "to": ["size", "in"] },
    { "from": ["size", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]
}
`;export{e as default};