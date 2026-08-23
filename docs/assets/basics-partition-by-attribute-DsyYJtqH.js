var e=`{\r
  "formatVersion": 1,\r
  "seed": 1017,\r
  "meta": {\r
    "title": "split one cloud into labelled groups",\r
    "description": "\`partitionByAttribute\` splits the input into one point cloud per distinct value of an i32, u32 or string attribute, so a single declared output holds several geometry items rather than one. Groups arrive in order of each value's first occurrence and each is tagged \`<name>=<value>\`, which is how a downstream node or a host routes them apart. The labels here come from a string \`setAttribute\` whose \`value\` acts as a per-point selector into \`values\`.",\r
    "tags": ["basics", "attributes", "partition", "routing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 300,\r
        "boundsMin": [-20, 0, -20],\r
        "boundsMax": [20, 0, 20]\r
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
        "value": { "fn": "mul", "args": [{ "fn": "randomField", "key": "species" }, 3] }\r
      }\r
    },\r
    {\r
      "id": "groups",\r
      "type": "partitionByAttribute",\r
      "params": { "name": "species" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["species", "in"] },\r
    { "from": ["species", "out"], "to": ["groups", "in"] }\r
  ],\r
  "outputs": [{ "id": "groups", "pin": "out", "name": "groups" }]\r
}\r
`;export{e as default};