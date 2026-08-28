var e=`{\r
  "formatVersion": 1,\r
  "seed": 1041,\r
  "meta": {\r
    "title": "hold a population to a stated mix",\r
    "description": "A draw gives a mix in EXPECTATION and any one population still misses: squaring the selector here skews the three kinds to roughly 58 / 24 / 18 percent, which is a perfectly good sampler and a broken requirement. \`quotaRebalance\` reads the kind and a share band per kind, and writes the smallest set of destinations that puts every share inside its band — to the nearest edge, so the over-full kind stops AT 40 percent rather than being driven to the middle. It decides and does not act: the \`species\` setAttribute below is what performs the change, choosing the destination where there is one (\`quotaTarget\` is -1 on every point that stays) and the point's own kind otherwise. \`priority\` is a hash rather than a coordinate on purpose — priority by position would take the first members along that axis and put every change in one corner of the patch, with the counts still exactly right.",\r
    "tags": ["basics", "attributes", "spawn", "population"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 400,\r
        "boundsMin": [-30, 0, -30],\r
        "boundsMax": [30, 0, 30]\r
      }\r
    },\r
    {\r
      "id": "kind",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "kind",\r
        "domain": "point",\r
        "type": "i32",\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                { "fn": "randomField", "key": "kind" },\r
                { "fn": "randomField", "key": "kind" }\r
              ]\r
            },\r
            3\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "quota",\r
      "type": "quotaRebalance",\r
      "params": {\r
        "category": { "fn": "attribute", "name": "kind" },\r
        "min": [0.25, 0.25, 0.25],\r
        "max": [0.4, 0.4, 0.4],\r
        "priority": { "fn": "randomField", "key": "mixOrder" }\r
      }\r
    },\r
    {\r
      "id": "species",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "species",\r
        "domain": "point",\r
        "type": "string",\r
        "values": ["pine", "birch", "boulder"],\r
        "value": {\r
          "fn": "select",\r
          "args": [\r
            { "fn": "ge", "args": [{ "fn": "attribute", "name": "quotaTarget" }, 0] },\r
            { "fn": "attribute", "name": "quotaTarget" },\r
            { "fn": "attribute", "name": "kind" }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "pine", "assetAttr": "species" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["kind", "in"] },\r
    { "from": ["kind", "out"], "to": ["quota", "in"] },\r
    { "from": ["quota", "out"], "to": ["species", "in"] },\r
    { "from": ["species", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]\r
}\r
`;export{e as default};