var e=`{
  "formatVersion": 1,
  "seed": 1014,
  "meta": {
    "title": "read a value off a surface below each point",
    "description": "\`transferAttribute\` copies an attribute from its \`source\` geometry onto the main input's points. Mapping 'raycast' casts a ray from each point along \`direction\` and interpolates the value at the nearest forward hit, which is how a scattered cloud reads the terrain under it. A point whose ray hits nothing keeps the value it already had — never an invented one — and \`missCountAttr\` records how many missed as a detail attribute so a graph can assert on it.",
    "tags": ["basics", "transfer", "mesh", "raycast"]
  },
  "nodes": [
    {
      "id": "ground",
      "type": "meshPrimitive",
      "params": {
        "shape": "plane",
        "size": [60, 0, 60],
        "center": [0, 0, 0],
        "orientation": "xz",
        "subdivisions": [16, 1, 16]
      }
    },
    {
      "id": "terrain",
      "type": "setAttribute",
      "params": {
        "name": "terrain",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "fbm",
          "base": "perlinNoise",
          "opts": {
            "seed": { "from": "node", "variant": 0 },
            "frequency": 0.03,
            "octaves": 4,
            "normalized": true,
            "position": { "fn": "position" }
          }
        }
      }
    },
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 400,
        "boundsMin": [-28, 10, -28],
        "boundsMax": [28, 10, 28]
      }
    },
    {
      "id": "sampleDown",
      "type": "transferAttribute",
      "params": {
        "name": "terrain",
        "mapping": "raycast",
        "direction": [0, -1, 0],
        "missCountAttr": "terrainMisses"
      }
    }
  ],
  "connections": [
    { "from": ["ground", "out"], "to": ["terrain", "in"] },
    { "from": ["scatter", "out"], "to": ["sampleDown", "in"] },
    { "from": ["terrain", "out"], "to": ["sampleDown", "source"] }
  ],
  "outputs": [{ "id": "sampleDown", "pin": "out", "name": "points" }]
}
`;export{e as default};