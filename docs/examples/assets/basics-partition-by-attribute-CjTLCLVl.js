var e=`{
  "formatVersion": 1,
  "seed": 1017,
  "meta": {
    "title": "split one cloud into labelled groups",
    "description": "\`partitionByAttribute\` splits the input into one point cloud per distinct value of an i32, u32 or string attribute, so a single declared output holds several geometry items rather than one. Groups arrive in order of each value's first occurrence and each is tagged \`<name>=<value>\`, which is how a downstream node or a host routes them apart. The labels here come from a string \`setAttribute\` whose \`value\` acts as a per-point selector into \`values\`.",
    "tags": ["basics", "attributes", "partition", "routing"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 300,
        "boundsMin": [-20, 0, -20],
        "boundsMax": [20, 0, 20]
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
        "value": { "fn": "mul", "args": [{ "fn": "randomField", "key": "species" }, 3] }
      }
    },
    {
      "id": "groups",
      "type": "partitionByAttribute",
      "params": { "name": "species" }
    }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["species", "in"] },
    { "from": ["species", "out"], "to": ["groups", "in"] }
  ],
  "outputs": [{ "id": "groups", "pin": "out", "name": "groups" }]
}
`;export{e as default};