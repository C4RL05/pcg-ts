var e=`{\r
  "formatVersion": 1,\r
  "seed": 2026,\r
  "meta": {\r
    "title": "treat each group on its own",\r
    "description": "\`partitionByAttribute\` splits the cloud into one geometry per district, and \`forEach\` cooks its inner graph once per group instead of once — so each district shakes loose on its own seed rather than all four sharing one. Exactly one exposed input must be named \`each\` (one iteration per item) or \`eachPoint\` (one per point); every other exposed input is broadcast whole to every iteration. Each iteration is seeded on its group's own CONTENT, never on where the group sat in the collection, so reordering the input reorders the output and re-rolls none of it. The \`groups\` output is the four separate results, still tagged \`district=<value>\`; \`points\` is the same four put back together with \`mergePoints\`, which is how you return to a single cloud.",\r
    "tags": [\r
      "basics",\r
      "foreach",\r
      "partition",\r
      "composite"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 900,\r
        "boundsMin": [\r
          -24,\r
          0,\r
          -24\r
        ],\r
        "boundsMax": [\r
          24,\r
          0,\r
          24\r
        ],\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "district",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "district",\r
        "domain": "point",\r
        "type": "string",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "valueNoise",\r
              "opts": {\r
                "frequency": 0.06,\r
                "seed": { "from": "node", "variant": 41 },\r
                "position": { "fn": "position" }\r
              }\r
            },\r
            4\r
          ]\r
        },\r
        "values": [\r
          "north",\r
          "east",\r
          "south",\r
          "west"\r
        ],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "groups",\r
      "type": "partitionByAttribute",\r
      "params": {\r
        "name": "district"\r
      }\r
    },\r
    {\r
      "id": "each",\r
      "type": "forEach",\r
      "params": {},\r
      "subgraph": {\r
        "graph": {\r
          "formatVersion": 1,\r
          "seed": 0,\r
          "nodes": [\r
            {\r
              "id": "shake",\r
              "type": "jitterPoints",\r
              "params": {\r
                "amount": [\r
                  2.5,\r
                  0,\r
                  2.5\r
                ],\r
                "seed": 0\r
              }\r
            }\r
          ],\r
          "connections": [],\r
          "outputs": []\r
        },\r
        "inputs": [\r
          {\r
            "name": "each",\r
            "node": "shake",\r
            "pin": "in"\r
          }\r
        ],\r
        "outputs": [\r
          {\r
            "name": "out",\r
            "node": "shake",\r
            "pin": "out"\r
          }\r
        ]\r
      }\r
    },\r
    {\r
      "id": "rejoin",\r
      "type": "mergePoints",\r
      "params": {}\r
    }\r
  ],\r
  "connections": [\r
    {\r
      "from": [\r
        "scatter",\r
        "out"\r
      ],\r
      "to": [\r
        "district",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "district",\r
        "out"\r
      ],\r
      "to": [\r
        "groups",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "groups",\r
        "out"\r
      ],\r
      "to": [\r
        "each",\r
        "each"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "each",\r
        "out"\r
      ],\r
      "to": [\r
        "rejoin",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "each",\r
      "pin": "out",\r
      "name": "groups"\r
    },\r
    {\r
      "id": "rejoin",\r
      "pin": "out",\r
      "name": "points"\r
    }\r
  ]\r
}\r
`;export{e as default};