var e=`{
  "formatVersion": 1,
  "seed": 1019,
  "meta": {
    "title": "turn points into instance batches",
    "description": "\`spawnInstances\` is a terminal: it converts a point cloud into render-agnostic instance batches, one 4x4 world matrix per point composed as T(P) * R(rot) * S(scale) from the standard attributes. Points group into one batch per asset id. The node has two output pins — \`instances\` for the batches and \`points\`, which passes the input through unchanged for chaining or debug rendering — and this graph declares only the first.",
    "tags": ["basics", "spawn", "instancing"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 250,
        "boundsMin": [-20, 0, -20],
        "boundsMax": [20, 0, 20]
      }
    },
    {
      "id": "size",
      "type": "setAttribute",
      "params": {
        "name": "scale",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "remap",
          "args": [
            {
              "fn": "perlinNoise",
              "opts": {
                "frequency": 0.08,
                "seed": 9,
                "position": {
                  "fn": "add",
                  "args": [
                    { "fn": "position" },
                    {
                      "fn": "vec",
                      "args": [
                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }] }] }, 0.936424255] }, 400] },
                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }] }] }, 0.243896484] }, 400] },
                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }] }] }, 0.990478516] }, 400] }
                      ]
                    }
                  ]
                }
              }
            },
            -1,
            1,
            0.6,
            1.4
          ]
        }
      }
    },
    {
      "id": "spawn",
      "type": "spawnInstances",
      "params": { "assetId": "boulder" }
    }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["size", "in"] },
    { "from": ["size", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]
}
`;export{e as default};