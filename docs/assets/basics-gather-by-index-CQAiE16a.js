var e=`{\r
  "formatVersion": 1,\r
  "seed": 9043,\r
  "meta": {\r
    "title": "two hundred props each pick one of five kinds, by drawing its number",\r
    "description": "A TABLE, A CLOUD, AND A NUMBER THAT JOINS THEM. Five points carry a catalog — a colour and a size per row. Two hundred scattered points carry one number each, \`floor(u * 5)\`, drawn independently. \`transferByIndex\` reads row \`pick\` of the catalog onto every one of them. That is a database join in a point graph, and until this node it had no spelling.\\n\\nWHY IT IS NOT A MAPPING ON \`transferAttribute\`. That node offers three mappings and every one asks its question in SPACE: which source point is nearest, which triangle contains this UV, what does this ray hit. None of them can answer \\"read row three\\". The distinction is not pedantic — a \`nearest\` gather would make the catalog's LAYOUT decide the answer, so moving a row would silently change which props got it, and two rows at the same position would be indistinguishable. An index is not a position, and a param list that decided which of two incompatible questions was being asked would be one node in name only.\\n\\nWHAT AN INDEX OFF THE END DOES, which is the whole of the node's edge behaviour. \`outOfRange\` names the reading: \`clamp\` pins into [0, count-1]; \`wrap\` takes a EUCLIDEAN modulo, so -1 is the LAST row rather than JavaScript's -1; \`miss\` leaves the destination's prior value and flags it through \`hitAttr\`. An EMPTY source misses every point under all three, because there is no row to clamp or wrap TO. The index truncates toward zero before any of that applies, so \`floor\` in the expression and truncation in the node agree on every non-negative draw.\\n\\nTHE UNIFORM PICK IS THE IDIOM. \`floor(mul(randomField(key), n))\` is how a point chooses one of n things with replacement, and \`n\` here is written literally because the catalog's size is known to the author. Where it is not, \`attributeReduce\` in \`count\` mode puts the row count on the detail domain and \`promoteAttribute\` brings it down to be read as a field — which is what a clustered scatter needs, since the number of clusters is itself decided by the graph.\\n\\nSTRINGS COME ACROSS. An empty \`attributes\` list gathers every point attribute of the source except the eight bookkeeping columns, and unlike \`transferAlongPath\` that includes STRING columns — that node interpolates and there is no value between two strings, while this one copies. Gathering an asset id by index is the case that matters, and it is why the exception exists.",\r
    "tags": ["basics", "attributes", "transfer", "field", "table", "instancing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "catalog",\r
      "type": "pointGrid",\r
      "params": { "countX": 5, "countY": 1, "countZ": 1, "spacing": [6, 1, 1], "origin": [0, 0, 0] }\r
    },\r
    {\r
      "id": "catalogTint",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "color",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            { "fn": "fract", "args": [{ "fn": "mul", "args": [{ "fn": "index" }, 0.37] }] },\r
            { "fn": "fract", "args": [{ "fn": "mul", "args": [{ "fn": "index" }, 0.61] }] },\r
            0.8\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "catalogSize",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            0.7,\r
            { "fn": "add", "args": [0.8, { "fn": "mul", "args": [{ "fn": "index" }, 0.9] }] },\r
            0.7\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "cloud",\r
      "type": "pointScatterInBounds",\r
      "params": { "count": 200, "boundsMin": [-30, 0, -30], "boundsMax": [30, 0, 30], "seed": 5 }\r
    },\r
    {\r
      "id": "pick",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "pick",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "floor",\r
          "args": [{ "fn": "mul", "args": [{ "fn": "randomField", "key": "pick" }, 5] }]\r
        }\r
      }\r
    },\r
    {\r
      "id": "join",\r
      "type": "transferByIndex",\r
      "params": {\r
        "index": { "fn": "attribute", "name": "pick" },\r
        "attributes": ["color", "scale"],\r
        "outOfRange": "clamp"\r
      }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "prop", "colorAttr": "color" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["catalog", "out"], "to": ["catalogTint", "in"] },\r
    { "from": ["catalogTint", "out"], "to": ["catalogSize", "in"] },\r
    { "from": ["cloud", "out"], "to": ["pick", "in"] },\r
    { "from": ["pick", "out"], "to": ["join", "in"] },\r
    { "from": ["catalogSize", "out"], "to": ["join", "source"] },\r
    { "from": ["join", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "catalogSize", "pin": "out", "name": "catalog" },\r
    { "id": "spawn", "pin": "instances", "name": "props" }\r
  ]\r
}\r
`;export{e as default};