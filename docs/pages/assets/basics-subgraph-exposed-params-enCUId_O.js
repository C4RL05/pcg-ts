var e=`{
  "formatVersion": 1,
  "seed": 1021,
  "meta": {
    "title": "wrap a graph as one node with its own knobs",
    "description": "A \`subgraph\` node carries an inner graph plus the pins and params it exposes, so a reusable piece becomes a single node with a deliberately small interface. Declarations live in the payload and VALUES live in the node's own \`params\`, exactly as a standard node keeps its schema in the registry and its value on the node. A declaration may not carry \`type\`, \`enum\` or \`acceptsField\` — those are re-derived from the targets' registered schemas, so a payload cannot claim a capability the inner params do not have.",
    "tags": ["basics", "subgraph", "composition", "params"]
  },
  "nodes": [
    {
      "id": "grove",
      "type": "subgraph",
      "params": { "count": 2500, "spacing": 3.5 },
      "subgraph": {
        "graph": {
          "formatVersion": 1,
          "seed": 0,
          "nodes": [
            {
              "id": "scatter",
              "type": "pointScatterInBounds",
              "params": {
                "count": 2500,
                "boundsMin": [-25, 0, -25],
                "boundsMax": [25, 0, 25]
              }
            },
            { "id": "prune", "type": "selfPrune", "params": { "minDistance": 3.5 } }
          ],
          "connections": [{ "from": ["scatter", "out"], "to": ["prune", "in"] }],
          "outputs": []
        },
        "inputs": [],
        "outputs": [{ "name": "out", "node": "prune", "pin": "out" }],
        "params": [
          {
            "name": "count",
            "targets": [{ "node": "scatter", "param": "count" }],
            "description": "Candidates scattered before pruning. Over-scatter: the survivor count is emergent, capped by the area divided by spacing squared.",
            "default": 2500,
            "min": 0
          },
          {
            "name": "spacing",
            "targets": [{ "node": "prune", "param": "minDistance" }],
            "description": "Closest two kept points may be, in world units. This is the knob that actually controls the result.",
            "default": 3.5,
            "min": 0
          }
        ]
      }
    }
  ],
  "connections": [],
  "outputs": [{ "id": "grove", "pin": "out", "name": "points" }]
}
`;export{e as default};