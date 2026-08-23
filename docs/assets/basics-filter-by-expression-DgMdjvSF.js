var e=`{\r
  "formatVersion": 1,\r
  "seed": 1006,\r
  "meta": {\r
    "title": "keep points with a predicate expression",\r
    "description": "\`filterByExpression\` decides per point from a field expression, so a test that would otherwise need a scratch attribute plus a comparison node becomes one node with no leftover column. The comparison functions emit 1 and 0, \`mul\` combines them as AND (and \`max\` as OR): this predicate keeps points inside a radius of 20 AND where a value-noise field rises above 0.4. NaN never passes, so a predicate that fails to compute drops the point.",\r
    "tags": ["basics", "filter", "fields", "predicate"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 1200,\r
        "boundsMin": [-30, 0, -30],\r
        "boundsMax": [30, 0, 30]\r
      }\r
    },\r
    {\r
      "id": "keep",\r
      "type": "filterByExpression",\r
      "params": {\r
        "predicate": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "lt",\r
              "args": [{ "fn": "length", "args": [{ "fn": "position" }] }, 20]\r
            },\r
            {\r
              "fn": "gt",\r
              "args": [\r
                {\r
                  "fn": "valueNoise",\r
                  "opts": {\r
                    "frequency": 0.06,\r
                    "seed": { "from": "node", "variant": 3 },\r
                    "position": { "fn": "position" }\r
                  }\r
                },\r
                0.4\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    }\r
  ],\r
  "connections": [{ "from": ["scatter", "out"], "to": ["keep", "in"] }],\r
  "outputs": [{ "id": "keep", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};