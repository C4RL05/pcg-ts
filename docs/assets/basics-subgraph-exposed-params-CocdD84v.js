var e=`{\r
  "formatVersion": 1,\r
  "seed": 1021,\r
  "meta": {\r
    "title": "wrap a graph as one node with its own knobs",\r
    "description": "A \`subgraph\` node carries an inner graph plus the pins and params it exposes, so a reusable piece becomes a single node with a deliberately small interface. Declarations live in the payload and VALUES live in the node's own \`params\`, exactly as a standard node keeps its schema in the registry and its value on the node. A declaration may not carry \`type\`, \`enum\` or \`acceptsField\` — those are re-derived from the targets' registered schemas, so a payload cannot claim a capability the inner params do not have.",\r
    "tags": ["basics", "subgraph", "composition", "params"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grove",\r
      "type": "subgraph",\r
      "params": { "count": 2500, "spacing": 3.5 },\r
      "subgraph": {\r
        "graph": {\r
          "formatVersion": 1,\r
          "seed": 0,\r
          "nodes": [\r
            {\r
              "id": "scatter",\r
              "type": "pointScatterInBounds",\r
              "params": {\r
                "count": 2500,\r
                "boundsMin": [-25, 0, -25],\r
                "boundsMax": [25, 0, 25]\r
              }\r
            },\r
            { "id": "prune", "type": "selfPrune", "params": { "minDistance": 3.5 } }\r
          ],\r
          "connections": [{ "from": ["scatter", "out"], "to": ["prune", "in"] }],\r
          "outputs": []\r
        },\r
        "inputs": [],\r
        "outputs": [{ "name": "out", "node": "prune", "pin": "out" }],\r
        "params": [\r
          {\r
            "name": "count",\r
            "targets": [{ "node": "scatter", "param": "count" }],\r
            "description": "Candidates scattered before pruning. Over-scatter: the survivor count is emergent, capped by the area divided by spacing squared.",\r
            "default": 2500,\r
            "min": 0\r
          },\r
          {\r
            "name": "spacing",\r
            "targets": [{ "node": "prune", "param": "minDistance" }],\r
            "description": "Closest two kept points may be, in world units. This is the knob that actually controls the result.",\r
            "default": 3.5,\r
            "min": 0\r
          }\r
        ]\r
      }\r
    }\r
  ],\r
  "connections": [],\r
  "outputs": [{ "id": "grove", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};