var e=`{
  "formatVersion": 1,
  "seed": 1015,
  "meta": {
    "title": "move an attribute between domains",
    "description": "Attributes live on domains — point, vertex, primitive, detail — and \`promoteAttribute\` walks the geometry's topology to move one between them. Here a per-point \`height\` becomes a per-triangle \`height\` by averaging the corners, which is what a shader or an exporter that colours faces rather than corners needs. Elements with no contributors keep the attribute default, and string attributes support only mode 'first'.",
    "tags": ["basics", "attributes", "domains", "promote"]
  },
  "nodes": [
    {
      "id": "ground",
      "type": "meshPrimitive",
      "params": {
        "shape": "plane",
        "size": [30, 0, 30],
        "center": [0, 0, 0],
        "orientation": "xz",
        "subdivisions": [6, 1, 6]
      }
    },
    {
      "id": "height",
      "type": "setAttribute",
      "params": {
        "name": "height",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "perlinNoise",
          "opts": {
            "frequency": 0.04,
            "seed": 11,
            "normalized": true,
            "position": {
              "fn": "add",
              "args": [
                { "fn": "position" },
                {
                  "fn": "vec",
                  "args": [
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }] }] }, 0.346130371] }, 800] },
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }] }] }, 0.798828125] }, 800] },
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }] }] }, 0.891357422] }, 800] }
                  ]
                }
              ]
            }
          }
        }
      }
    },
    {
      "id": "perFace",
      "type": "promoteAttribute",
      "params": { "name": "height", "from": "point", "to": "primitive", "mode": "average" }
    }
  ],
  "connections": [
    { "from": ["ground", "out"], "to": ["height", "in"] },
    { "from": ["height", "out"], "to": ["perFace", "in"] }
  ],
  "outputs": [{ "id": "perFace", "pin": "out", "name": "mesh" }]
}
`;export{e as default};