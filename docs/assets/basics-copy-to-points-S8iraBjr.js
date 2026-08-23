var e=`{\r
  "formatVersion": 1,\r
  "seed": 1051,\r
  "meta": {\r
    "title": "give every copy the attributes of the point it landed on",\r
    "description": "\`copyToPoints\` stamps the whole \`source\` cloud onto every \`target\` point and composes the transforms per copy — P, rot and scale fold the target's frame into the source's, and each copied seed is hashCombine(sourceSeed, targetSeed) so the copies of one clump stay distinguishable. What the copies do NOT get by default is any idea of WHICH target they landed on, which makes them identical in everything but placement. \`targetNames\` is the fix: each named target point attribute arrives as a column on the copies, with the target's type, tuple size and default, and every copy in a target's block holds that target's value. Here the clump of nine props is a bare \`pointGrid\` around the origin, and the two things that vary between clumps — \`species\` and \`vigour\` — are computed once per plot and carried. \`species\` is the case nothing else reaches: it is a STRING, so \`spawnInstances\`' \`assetAttr\` can split the copies into one batch per asset id, and no amount of transform composition can decide an asset id. \`vigour\` is the case that shows why a carried value beats a composed one — the \`scale\` written after the copy multiplies the plot's vigour by a per-copy \`randomField\`, so a clump's props agree on how well the plot is doing and still differ from each other. The transform attributes are refused by name rather than resolved silently: carrying the target's \`P\` would put all nine props on top of the plot and the cook would stay clean, so \`targetNames\` rejects P, rot, scale and seed, and rejects a name the source already carries instead of letting statement order decide the winner.",\r
    "tags": ["basics", "copy", "instancing", "attributes"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "plots",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 24,\r
        "boundsMin": [-30, 0, -30],\r
        "boundsMax": [30, 0, 30]\r
      }\r
    },\r
    {\r
      "id": "species",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "species",\r
        "domain": "point",\r
        "type": "string",\r
        "values": ["pine", "pine", "birch"],\r
        "value": { "fn": "mul", "args": [{ "fn": "randomField", "key": "species" }, 3] }\r
      }\r
    },\r
    {\r
      "id": "vigour",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "vigour",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": { "fn": "remap", "args": [{ "fn": "randomField", "key": "vigour" }, 0, 1, 0.4, 1.6] }\r
      }\r
    },\r
    {\r
      "id": "clump",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 3,\r
        "countY": 1,\r
        "countZ": 3,\r
        "spacing": [1.6, 0, 1.6],\r
        "origin": [-1.6, 0, -1.6]\r
      }\r
    },\r
    {\r
      "id": "copies",\r
      "type": "copyToPoints",\r
      "params": { "targetNames": ["species", "vigour"] }\r
    },\r
    {\r
      "id": "size",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            { "fn": "attribute", "name": "vigour" },\r
            { "fn": "remap", "args": [{ "fn": "randomField", "key": "size" }, 0, 1, 0.6, 1.1] }\r
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
    { "from": ["plots", "out"], "to": ["species", "in"] },\r
    { "from": ["species", "out"], "to": ["vigour", "in"] },\r
    { "from": ["clump", "out"], "to": ["copies", "source"] },\r
    { "from": ["vigour", "out"], "to": ["copies", "target"] },\r
    { "from": ["copies", "out"], "to": ["size", "in"] },\r
    { "from": ["size", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "size", "pin": "out", "name": "points" },\r
    { "id": "spawn", "pin": "instances", "name": "instances" }\r
  ]\r
}\r
`;export{e as default};