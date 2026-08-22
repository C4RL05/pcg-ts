var e=`{
  "formatVersion": 1,
  "seed": 1051,
  "meta": {
    "title": "give every copy the attributes of the point it landed on",
    "description": "\`copyToPoints\` stamps the whole \`source\` cloud onto every \`target\` point and composes the transforms per copy — P, rot and scale fold the target's frame into the source's, and each copied seed is hashCombine(sourceSeed, targetSeed) so the copies of one clump stay distinguishable. What the copies do NOT get by default is any idea of WHICH target they landed on, which makes them identical in everything but placement. \`targetNames\` is the fix: each named target point attribute arrives as a column on the copies, with the target's type, tuple size and default, and every copy in a target's block holds that target's value. Here the clump of nine props is a bare \`pointGrid\` around the origin, and the two things that vary between clumps — \`species\` and \`vigour\` — are computed once per plot and carried. \`species\` is the case nothing else reaches: it is a STRING, so \`spawnInstances\`' \`assetAttr\` can split the copies into one batch per asset id, and no amount of transform composition can decide an asset id. \`vigour\` is the case that shows why a carried value beats a composed one — the \`scale\` written after the copy multiplies the plot's vigour by a per-copy \`randomField\`, so a clump's props agree on how well the plot is doing and still differ from each other. The transform attributes are refused by name rather than resolved silently: carrying the target's \`P\` would put all nine props on top of the plot and the cook would stay clean, so \`targetNames\` rejects P, rot, scale and seed, and rejects a name the source already carries instead of letting statement order decide the winner.",
    "tags": ["basics", "copy", "instancing", "attributes"]
  },
  "nodes": [
    {
      "id": "plots",
      "type": "pointScatterInBounds",
      "params": {
        "count": 24,
        "boundsMin": [-30, 0, -30],
        "boundsMax": [30, 0, 30]
      }
    },
    {
      "id": "species",
      "type": "setAttribute",
      "params": {
        "name": "species",
        "domain": "point",
        "type": "string",
        "values": ["pine", "pine", "birch"],
        "value": { "fn": "mul", "args": [{ "fn": "randomField", "key": "species" }, 3] }
      }
    },
    {
      "id": "vigour",
      "type": "setAttribute",
      "params": {
        "name": "vigour",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": { "fn": "remap", "args": [{ "fn": "randomField", "key": "vigour" }, 0, 1, 0.4, 1.6] }
      }
    },
    {
      "id": "clump",
      "type": "pointGrid",
      "params": {
        "countX": 3,
        "countY": 1,
        "countZ": 3,
        "spacing": [1.6, 0, 1.6],
        "origin": [-1.6, 0, -1.6]
      }
    },
    {
      "id": "copies",
      "type": "copyToPoints",
      "params": { "targetNames": ["species", "vigour"] }
    },
    {
      "id": "size",
      "type": "setAttribute",
      "params": {
        "name": "scale",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "mul",
          "args": [
            { "fn": "attribute", "name": "vigour" },
            { "fn": "remap", "args": [{ "fn": "randomField", "key": "size" }, 0, 1, 0.6, 1.1] }
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
    { "from": ["plots", "out"], "to": ["species", "in"] },
    { "from": ["species", "out"], "to": ["vigour", "in"] },
    { "from": ["clump", "out"], "to": ["copies", "source"] },
    { "from": ["vigour", "out"], "to": ["copies", "target"] },
    { "from": ["copies", "out"], "to": ["size", "in"] },
    { "from": ["size", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [
    { "id": "size", "pin": "out", "name": "points" },
    { "id": "spawn", "pin": "instances", "name": "instances" }
  ]
}
`;export{e as default};