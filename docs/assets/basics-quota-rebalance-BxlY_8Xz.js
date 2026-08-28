var e=`{
  "formatVersion": 1,
  "seed": 1041,
  "meta": {
    "title": "hold a population to a stated mix",
    "description": "A draw gives a mix in EXPECTATION and any one population still misses: squaring the selector here skews the three kinds to roughly 58 / 24 / 18 percent, which is a perfectly good sampler and a broken requirement. \`quotaRebalance\` reads the kind and a share band per kind, and writes the smallest set of destinations that puts every share inside its band — to the nearest edge, so the over-full kind stops AT 40 percent rather than being driven to the middle. It decides and does not act: the \`species\` setAttribute below is what performs the change, choosing the destination where there is one (\`quotaTarget\` is -1 on every point that stays) and the point's own kind otherwise. \`priority\` is a hash rather than a coordinate on purpose — priority by position would take the first members along that axis and put every change in one corner of the patch, with the counts still exactly right.",
    "tags": ["basics", "attributes", "spawn", "population"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 400,
        "boundsMin": [-30, 0, -30],
        "boundsMax": [30, 0, 30]
      }
    },
    {
      "id": "kind",
      "type": "setAttribute",
      "params": {
        "name": "kind",
        "domain": "point",
        "type": "i32",
        "value": {
          "fn": "mul",
          "args": [
            {
              "fn": "mul",
              "args": [
                { "fn": "randomField", "key": "kind" },
                { "fn": "randomField", "key": "kind" }
              ]
            },
            3
          ]
        }
      }
    },
    {
      "id": "quota",
      "type": "quotaRebalance",
      "params": {
        "category": { "fn": "attribute", "name": "kind" },
        "min": [0.25, 0.25, 0.25],
        "max": [0.4, 0.4, 0.4],
        "priority": { "fn": "randomField", "key": "mixOrder" }
      }
    },
    {
      "id": "species",
      "type": "setAttribute",
      "params": {
        "name": "species",
        "domain": "point",
        "type": "string",
        "values": ["pine", "birch", "boulder"],
        "value": {
          "fn": "select",
          "args": [
            { "fn": "ge", "args": [{ "fn": "attribute", "name": "quotaTarget" }, 0] },
            { "fn": "attribute", "name": "quotaTarget" },
            { "fn": "attribute", "name": "kind" }
          ]
        }
      }
    },
    {
      "id": "spawn",
      "type": "spawnInstances",
      "params": { "assetId": "pine", "assetAttr": "species" }
    }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["kind", "in"] },
    { "from": ["kind", "out"], "to": ["quota", "in"] },
    { "from": ["quota", "out"], "to": ["species", "in"] },
    { "from": ["species", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]
}
`;export{e as default};