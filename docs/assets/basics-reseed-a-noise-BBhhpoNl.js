var e=`{
  "formatVersion": 1,
  "seed": 1048,
  "meta": {
    "title": "make a saved noise re-roll with the graph seed",
    "description": "A serialized field expression bakes its numbers, so a noise that carries \`opts.seed\` as a literal leaves the graph's seed box moving every scatter and jitter while the shape stays exactly where it was. \`opts.seed\` is the way out, because besides an integer it takes one tagged form: \`{ \\"from\\": \\"node\\", \\"variant\\": 5 }\` derives this noise's seed as \`hashCombine(the cooking node's own seed, variant)\`, the node seed being \`deriveNodeSeed(graph seed, node id)\` — the same number \`randomField\` hashes. So the seed box now moves this surface and not merely the points on it. Every part of that shape is load-bearing. The whole derivation is u32 murmur with no float anywhere in it, which is why it is bit-exact on CPU and GPU rather than budgeted the way a noise interior is: a seed has no tolerance, since a one-ULP disagreement in one is not a rounding error in the output but \`hashCombine\` avalanching to an unrelated number and the two paths cooking different noises. That is also why the position is the one noise option that takes a spec and the seed admits no arbitrary expression — every field column is f32, so a seed read through one would arrive already rounded to 24 bits. \`variant\` stands where the old literal seed stood, and it picks WHICH draw off this node: two noises on one node with different variants are two independent fields, which is how a single node yields several. It is capped at 2^24, where an f32 stops holding every integer, because the GPU may read it back through a uniform slot — a variant is a slot number, not a seed. Adopting the form RE-ROLLS the noise: frequency, amplitude, position and normalization are untouched, but the field is a different draw from the same family, so it is an edit made once and deliberately rather than a new default. Change the seed and this surface becomes a different surface; write a literal back into \`opts.seed\` and it is deaf to the seed again.",
    "tags": ["basics", "fields", "noise", "determinism"]
  },
  "nodes": [
    {
      "id": "grid",
      "type": "pointGrid",
      "params": {
        "countX": 44,
        "countY": 1,
        "countZ": 44,
        "spacing": [1.4, 1, 1.4],
        "origin": [-30, 0, -30]
      }
    },
    {
      "id": "lift",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "vec",
          "args": [
            0,
            {
              "fn": "remap",
              "args": [
                {
                  "fn": "perlinNoise",
                  "opts": {
                    "seed": { "from": "node", "variant": 5 },
                    "frequency": 0.045,
                    "normalized": true,
                    "position": { "fn": "position" }
                  }
                },
                0,
                1,
                -6,
                6
              ]
            },
            0
          ]
        }
      }
    }
  ],
  "connections": [{ "from": ["grid", "out"], "to": ["lift", "in"] }],
  "outputs": [{ "id": "lift", "pin": "out", "name": "points" }]
}
`;export{e as default};