var e=`{
  "formatVersion": 1,
  "seed": 1063,
  "meta": {
    "title": "keep a random draw when the point moves",
    "description": "TWO DRAWS, ONE NODE EACH, AND THE ONLY DIFFERENCE IS WHAT GETS HASHED. \`randomField\` keys on a point's IDENTITY — the bit pattern of its stored position folded with its \`seed\` attribute — so the number belongs to the point and survives reordering, filtering, and being re-derived inside a neighbour's halo. What it does NOT survive is the point MOVING. \`randomFrom\` keys on a VALUE the graph computes instead, so a draw can be pinned to something that does not move with the point: a station, a lane, a lot index, an arc coordinate.\\n\\nTHE FOUR ROWS ARE ONE CLOUD DRAWN TWICE. A row of 16 points takes a \`station\` number from \`index\`, then a copy of it is translated 2 along Z and \`mergePoints\` concatenates the two — so the near row and the far row are the same 16 stations at different positions. Both draws then run on that merged cloud, ONE NODE apiece. That is what makes the picture honest: a node's seed is \`deriveNodeSeed(graph seed, node id)\`, so two draw nodes would differ whatever the points did, and the comparison would prove nothing. Here each draw is a single node evaluating a single expression over both rows, and the two rows agree or disagree for one reason only.\\n\\nWHAT YOU SEE. The near block is coloured by the identity draw and its two rows disagree column by column. The far block is coloured by the keyed draw and its two rows match, column for column. Both expressions carry the same \`key: \\"pose\\"\` salt, so the salt is not the variable — the hashed thing is. A PURE TRANSLATE IS ENOUGH; nothing is jittered here, because \\"I only moved it\\" is exactly the assumption this breaks. The far block's own 14-along-Z offset is applied AFTER both draws and changes neither: once a draw is stored in an attribute it is frozen, and it is the RE-EVALUATION at a new position that returns a different number, not the move itself.\\n\\nTHE KEY IS HASHED AS BITS, NOT AS A NUMBER, which is the trap next to the point. The key here is \`floor(station / bucket size)\`, and the \`floor\` is the whole of it: at a bucket size of 1 every station keys for itself, at 3 the far block bands into threes that share a colour — five of them and a runt, since 16 stations do not divide by 3 — and \`station / 3\` WITHOUT the floor names 16 distinct values again and bands nothing. Two keys differing anywhere in their f32 representation are independent draws, so there is no interval that maps to one stream — quantise deliberately when you mean buckets. A whole number needs no rounding — an f32 holds every integer up to 2^24, which is why \`station\` is an \`i32\` and a station index hashes straight. A key must also be ONE number per element; a tuple is refused rather than folded, and a key attribute that is not there raises rather than drawing from zero.\\n\\nWHY IT EXISTS. Anything that settles by moving things needs this: a repair or relaxation loop that nudges placements every round would re-roll every one of them each pass if the draw were keyed on where they sit. Keyed on the station they hold instead, the population keeps its faces while the loop keeps working. \`randomField\` is still the right answer to \\"give this point a number\\" — this is the other question.",
    "tags": ["basics", "fields", "determinism", "attributes", "instancing"]
  },
  "nodes": [
    {
      "id": "row",
      "type": "pointGrid",
      "params": {
        "countX": 16,
        "countY": 1,
        "countZ": 1,
        "spacing": [3, 1, 1],
        "origin": [-22.5, 0, 0]
      }
    },
    {
      "id": "station",
      "type": "setAttribute",
      "params": {
        "name": "station",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": { "fn": "index" }
      }
    },
    {
      "id": "size",
      "type": "setAttribute",
      "params": {
        "name": "scale",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": { "fn": "vec", "args": [2, 2.4, 1.9] }
      }
    },
    {
      "id": "moved",
      "type": "transformPoints",
      "params": { "translate": [0, 0, 2] }
    },
    { "id": "both", "type": "mergePoints", "params": {} },
    {
      "id": "drawOnIdentity",
      "type": "setAttribute",
      "params": {
        "name": "hueIdentity",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": { "fn": "randomField", "key": "pose" }
      }
    },
    {
      "id": "drawOnStation",
      "type": "setAttribute",
      "params": {
        "name": "hueStation",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "randomFrom",
          "args": [
            {
              "fn": "floor",
              "args": [
                {
                  "fn": "div",
                  "args": [
                    { "fn": "attribute", "name": "station" },
                    {
                      "fn": "param",
                      "name": "bucketSize",
                      "value": 1,
                      "min": 1,
                      "max": 8,
                      "description": "How many neighbouring stations share one draw. At 1 every station keys for itself; at 3 the far block bands into threes, the last one a runt because 16 stations do not divide by 3. The \`floor\` around the division is what makes this a bucket — without it the same division names one value per station and bands nothing."
                    }
                  ]
                }
              ]
            }
          ],
          "key": "pose"
        }
      }
    },
    {
      "id": "tintIdentity",
      "type": "setAttribute",
      "params": {
        "name": "color",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            { "fn": "attribute", "name": "hueIdentity" },
            0.12,
            { "fn": "sub", "args": [1, { "fn": "attribute", "name": "hueIdentity" }] }
          ]
        }
      }
    },
    {
      "id": "farBlock",
      "type": "transformPoints",
      "params": { "translate": [0, 0, 14] }
    },
    {
      "id": "tintStation",
      "type": "setAttribute",
      "params": {
        "name": "color",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            { "fn": "attribute", "name": "hueStation" },
            0.12,
            { "fn": "sub", "args": [1, { "fn": "attribute", "name": "hueStation" }] }
          ]
        }
      }
    },
    {
      "id": "spawnIdentity",
      "type": "spawnInstances",
      "params": { "assetId": "prop", "colorAttr": "color" }
    },
    {
      "id": "spawnStation",
      "type": "spawnInstances",
      "params": { "assetId": "prop", "colorAttr": "color" }
    }
  ],
  "connections": [
    { "from": ["row", "out"], "to": ["station", "in"] },
    { "from": ["station", "out"], "to": ["size", "in"] },
    { "from": ["size", "out"], "to": ["moved", "in"] },
    { "from": ["size", "out"], "to": ["both", "in"] },
    { "from": ["moved", "out"], "to": ["both", "in"] },
    { "from": ["both", "out"], "to": ["drawOnIdentity", "in"] },
    { "from": ["drawOnIdentity", "out"], "to": ["drawOnStation", "in"] },
    { "from": ["drawOnStation", "out"], "to": ["tintIdentity", "in"] },
    { "from": ["drawOnStation", "out"], "to": ["farBlock", "in"] },
    { "from": ["farBlock", "out"], "to": ["tintStation", "in"] },
    { "from": ["tintIdentity", "out"], "to": ["spawnIdentity", "in"] },
    { "from": ["tintStation", "out"], "to": ["spawnStation", "in"] }
  ],
  "outputs": [
    { "id": "spawnIdentity", "pin": "instances", "name": "drawn on identity" },
    { "id": "spawnStation", "pin": "instances", "name": "drawn on station" }
  ]
}
`;export{e as default};