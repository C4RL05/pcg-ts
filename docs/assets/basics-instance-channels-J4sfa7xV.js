var e=`{
  "formatVersion": 1,
  "seed": 1071,
  "meta": {
    "title": "carry named per-instance channels to the host",
    "description": "\`spawnInstances\`' \`instanceAttrs\` is the ABI between a graph and the host that draws it. The field grammar has no time input on purpose — a graph settles STRUCTURE and the host animates it — so anything driven per instance at runtime (a phase, a stable id) has to leave on this list. Each entry becomes \`batch.attributes[<the attribute's own name>]\`, so the name in the graph is the name the host binds, and instance k of every channel is the same instance as \`transforms[k]\`. DTYPE AND TUPLE SIZE ARE PRESERVED, which is what this graph is really about: \`seed\` arrives as a \`Uint32Array\`, never widened to f32. It has to. The standard per-point \`seed\` is a full-range u32 identity hash, so nearly every value sits past 2^24 (16777216), where f32 stops representing consecutive integers — widen this column and the id read back is not the id written: the first point's 3932609219 comes back as 3932609280, a different instance to any host keying on it. The corollary is worth knowing and this graph cannot show it to you: fields evaluate in f32 too, so an id that large must COME from an integer column like this one rather than be computed in a field, where \`index + 16777216\` already returns 16777216 for both of the first two points. \`phase\` rides along as an ordinary f32 channel. Colour does not ride here at all: \`color\` is a reserved name that \`instanceAttrs\` refuses, because a renderer binds instance colour structurally rather than generically, so per-instance RGB goes through \`colorAttr\` — and \`batch.colors\` and \`batch.attributes[\\"color\\"]\` are then two spellings of that one buffer, not two buffers.",
    "tags": ["basics", "spawn", "instancing", "attributes"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 240,
        "boundsMin": [-20, 0, -20],
        "boundsMax": [20, 0, 20]
      }
    },
    {
      "id": "phase",
      "type": "setAttribute",
      "params": {
        "name": "phase",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": { "fn": "mul", "args": [{ "fn": "randomField", "key": "phase" }, 6.2831855] }
      }
    },
    {
      "id": "tint",
      "type": "setAttribute",
      "params": {
        "name": "tint",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            { "fn": "remap", "args": [{ "fn": "randomField", "key": "tint" }, 0, 1, 0.25, 0.6] },
            0.55,
            { "fn": "remap", "args": [{ "fn": "randomField", "key": "tint" }, 0, 1, 0.8, 0.3] }
          ]
        }
      }
    },
    {
      "id": "spawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "reed",
        "colorAttr": "tint",
        "instanceAttrs": ["seed", "phase"]
      }
    }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["phase", "in"] },
    { "from": ["phase", "out"], "to": ["tint", "in"] },
    { "from": ["tint", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]
}
`;export{e as default};