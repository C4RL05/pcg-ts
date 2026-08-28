var e=`{\r
  "formatVersion": 1,\r
  "seed": 2026,\r
  "meta": {\r
    "title": "run a body until it settles",\r
    "description": "\`repeatUntil\` cooks its inner graph again and again, feeding each round's \`carry\` output back into its own \`carry\` input, and stops when the body says nothing changed. This is the loop a DAG cannot wire — a wire from an output back to an input is a cycle, which \`connect\` refuses — so the feedback is an assignment between cooks instead. The body here is a damped descent: every round halves each point's height, then writes 1 for every point still further than 0.01 from the ground and reduces that to the DETAIL attribute \`moves\`. When \`moves\` reaches zero the cloud has settled and the loop stops; the scatter starts up to 8 high, so halving takes about ten rounds and the \`rounds\` output says exactly how many. Two things are worth reading off this graph. The settle signal rides the DETAIL domain because a wrapper has no non-geometry output pin — \`attributeReduce\` is what normally writes it, and an ABSENT \`moves\` is refused by name rather than read as zero, so a typo cannot report convergence on round one. And the body's seed is NOT rotated per round: a fixed point exists only if the body is the same function every time, so a body seeded on the round number can never converge, however many rounds it is given. Every real use has this skeleton — push overlapping props apart, snap dangling edges, repair a placement against a rule — and differs only in what one round does.",\r
    "tags": [\r
      "basics",\r
      "repeatuntil",\r
      "relaxation",\r
      "composite"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 600,\r
        "boundsMin": [\r
          -20,\r
          -8,\r
          -20\r
        ],\r
        "boundsMax": [\r
          20,\r
          8,\r
          20\r
        ],\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "settle",\r
      "type": "repeatUntil",\r
      "params": {\r
        "maxRounds": 12,\r
        "settleAttr": "moves"\r
      },\r
      "subgraph": {\r
        "graph": {\r
          "formatVersion": 1,\r
          "seed": 0,\r
          "nodes": [\r
            {\r
              "id": "halve",\r
              "type": "transformPoints",\r
              "params": {\r
                "translate": {\r
                  "fn": "mul",\r
                  "args": [\r
                    { "fn": "position" },\r
                    [0, -0.5, 0]\r
                  ]\r
                },\r
                "rotateEuler": [0, 0, 0],\r
                "scale": [1, 1, 1]\r
              }\r
            },\r
            {\r
              "id": "moving",\r
              "type": "setAttribute",\r
              "params": {\r
                "name": "moving",\r
                "domain": "point",\r
                "type": "f32",\r
                "tupleSize": 1,\r
                "value": {\r
                  "fn": "gt",\r
                  "args": [\r
                    {\r
                      "fn": "abs",\r
                      "args": [\r
                        { "fn": "component", "args": [{ "fn": "position" }], "index": 1 }\r
                      ]\r
                    },\r
                    0.01\r
                  ]\r
                },\r
                "select": 0,\r
                "values": [],\r
                "weights": [],\r
                "stringValue": "",\r
                "seed": 0\r
              }\r
            },\r
            {\r
              "id": "moves",\r
              "type": "attributeReduce",\r
              "params": {\r
                "name": "moving",\r
                "domain": "point",\r
                "mode": "sum",\r
                "outName": "moves"\r
              }\r
            }\r
          ],\r
          "connections": [\r
            {\r
              "from": ["halve", "out"],\r
              "to": ["moving", "in"]\r
            },\r
            {\r
              "from": ["moving", "out"],\r
              "to": ["moves", "in"]\r
            }\r
          ],\r
          "outputs": []\r
        },\r
        "inputs": [\r
          {\r
            "name": "carry",\r
            "node": "halve",\r
            "pin": "in"\r
          }\r
        ],\r
        "outputs": [\r
          {\r
            "name": "carry",\r
            "node": "moves",\r
            "pin": "out"\r
          }\r
        ]\r
      }\r
    }\r
  ],\r
  "connections": [\r
    {\r
      "from": ["scatter", "out"],\r
      "to": ["settle", "carry"]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "settle",\r
      "pin": "carry",\r
      "name": "points"\r
    },\r
    {\r
      "id": "settle",\r
      "pin": "rounds",\r
      "name": "rounds"\r
    },\r
    {\r
      "id": "settle",\r
      "pin": "converged",\r
      "name": "converged"\r
    }\r
  ]\r
}\r
`;export{e as default};