var e=`{
  "formatVersion": 1,
  "seed": 1004,
  "meta": {
    "title": "rescale an attribute to a new range",
    "description": "\`attributeRemap\` in mode 'fit' measures an attribute's actual minimum and maximum over the domain and stretches them onto [outMin, outMax], which is how a quantity of unknown scale — a raw noise value, a neighbour count, an invented score — becomes something a density or a colour can consume. \`outName\` writes the result beside the original instead of over it, so both columns survive for inspection.",
    "tags": ["basics", "attributes", "remap"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 400,
        "boundsMin": [-20, 0, -20],
        "boundsMax": [20, 0, 20]
      }
    },
    {
      "id": "score",
      "type": "setAttribute",
      "params": {
        "name": "score",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "perlinNoise",
          "opts": {
            "frequency": 0.05,
            "seed": { "from": "node", "variant": 7 },
            "position": { "fn": "position" }
          }
        }
      }
    },
    {
      "id": "fit",
      "type": "attributeRemap",
      "params": {
        "name": "score",
        "outName": "scoreFit",
        "domain": "point",
        "mode": "fit",
        "outMin": 0,
        "outMax": 1
      }
    }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["score", "in"] },
    { "from": ["score", "out"], "to": ["fit", "in"] }
  ],
  "outputs": [{ "id": "fit", "pin": "out", "name": "points" }]
}
`;export{e as default};