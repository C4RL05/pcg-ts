var e=`{
  "formatVersion": 1,
  "seed": 1005,
  "meta": {
    "title": "keep points by an attribute comparison",
    "description": "The first of the three ways to remove points: write a scalar column, then compare it. \`filterByAttribute\` tests one named point attribute against \`value\` with one of eq/ne/lt/le/gt/ge and keeps the survivors with every attribute carried. The scratch column stays on the output — \`removeAttribute\` is what takes it off again — which is the cost this idiom pays and \`filterByExpression\` avoids.",
    "tags": ["basics", "filter", "attributes"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 800,
        "boundsMin": [-30, 0, -30],
        "boundsMax": [30, 0, 30]
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
          "fn": "fbm",
          "base": "perlinNoise",
          "opts": {
            "frequency": 0.025,
            "octaves": 4,
            "normalized": true,
            "position": {
              "fn": "add",
              "args": [
                { "fn": "position" },
                {
                  "fn": "vec",
                  "args": [
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }] }] }, 0.202636719] }, 1280] },
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }] }] }, 0.0925292969] }, 1280] },
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }] }] }, 0.907714844] }, 1280] }
                  ]
                }
              ]
            }
          }
        }
      }
    },
    {
      "id": "ridge",
      "type": "filterByAttribute",
      "params": { "attribute": "height", "comparison": "gt", "value": 0.55 }
    }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["height", "in"] },
    { "from": ["height", "out"], "to": ["ridge", "in"] }
  ],
  "outputs": [{ "id": "ridge", "pin": "out", "name": "points" }]
}
`;export{e as default};