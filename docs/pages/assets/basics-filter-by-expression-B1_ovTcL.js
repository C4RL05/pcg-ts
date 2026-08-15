var e=`{
  "formatVersion": 1,
  "seed": 1006,
  "meta": {
    "title": "keep points with a predicate expression",
    "description": "\`filterByExpression\` decides per point from a field expression, so a test that would otherwise need a scratch attribute plus a comparison node becomes one node with no leftover column. The comparison functions emit 1 and 0, \`mul\` combines them as AND (and \`max\` as OR): this predicate keeps points inside a radius of 20 AND where a value-noise field rises above 0.4. NaN never passes, so a predicate that fails to compute drops the point.",
    "tags": ["basics", "filter", "fields", "predicate"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 1200,
        "boundsMin": [-30, 0, -30],
        "boundsMax": [30, 0, 30]
      }
    },
    {
      "id": "keep",
      "type": "filterByExpression",
      "params": {
        "predicate": {
          "fn": "mul",
          "args": [
            {
              "fn": "lt",
              "args": [{ "fn": "length", "args": [{ "fn": "position" }] }, 20]
            },
            {
              "fn": "gt",
              "args": [
                {
                  "fn": "valueNoise",
                  "opts": {
                    "frequency": 0.06,
                    "seed": 3,
                    "position": {
                      "fn": "add",
                      "args": [
                        { "fn": "position" },
                        {
                          "fn": "vec",
                          "args": [
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }] }] }, 0.173492432] }, 500] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }] }] }, 0.499633789] }, 500] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }] }] }, 0.767822266] }, 500] }
                          ]
                        }
                      ]
                    }
                  }
                },
                0.4
              ]
            }
          ]
        }
      }
    }
  ],
  "connections": [{ "from": ["scatter", "out"], "to": ["keep", "in"] }],
  "outputs": [{ "id": "keep", "pin": "out", "name": "points" }]
}
`;export{e as default};