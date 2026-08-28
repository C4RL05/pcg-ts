var e=`{
  "formatVersion": 1,
  "seed": 1049,
  "meta": {
    "title": "let a string attribute drive a field",
    "description": "\`attributeIs\` is the only way a field can read a STRING attribute: it resolves to 1 on the elements whose named string attribute equals the literal and 0 on every other one, so \`species\` — itself painted spatially here, because \`setAttribute\`'s string mode takes a field as the selector into \`values\` and this one is a noise — becomes an ordinary scalar field. It is a PREDICATE rather than an index on purpose. A string column stores positions in a per-geometry table that clone, filter and merge rebuild to first-encounter order, so the same value sits at different indices depending on what happened upstream, and in different cells of one partitioned world; the predicate resolves the index against the geometry in hand and never exposes it. The same fact makes a literal that is absent from the table read as all zeros instead of throwing — a cell holding no pines legitimately has no \`pine\`, so a misspelled literal reads as 'nothing matches'. Feeding the 0/1 column to \`lerp\` as the blend factor is what makes the point: both endpoints are continuous fields of \`moisture\` and both are evaluated for every point, and the mask chooses between them. It is a mask, not a branch — swap the \`lerp\` for a \`mul\` and the same column gates instead. The \`remap\` on the selector is only bookkeeping: Perlin's values bunch around the middle of its range, so a bare \`moisture * 3\` would put nearly nine points in ten in the middle band, and stretching the band the noise actually occupies across the three names is what makes the split roughly even. It needs no clamp of its own: \`setAttribute\` floors the selector and clamps it into range, and NaN picks entry 0, so no per-point value can miss.",
    "tags": ["basics", "fields", "attributes", "strings"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 600,
        "boundsMin": [-30, 0, -30],
        "boundsMax": [30, 0, 30]
      }
    },
    {
      "id": "moisture",
      "type": "setAttribute",
      "params": {
        "name": "moisture",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "perlinNoise",
          "opts": {
            "seed": { "from": "node", "variant": 0 },
            "frequency": 0.032,
            "normalized": true,
            "position": { "fn": "position" }
          }
        }
      }
    },
    {
      "id": "species",
      "type": "setAttribute",
      "params": {
        "name": "species",
        "domain": "point",
        "type": "string",
        "values": ["grass", "birch", "pine"],
        "value": { "fn": "remap", "args": [{ "fn": "attribute", "name": "moisture" }, 0.38, 0.67, 0, 3] }
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
        "value": {
          "fn": "lerp",
          "args": [
            { "fn": "add", "args": [0.3, { "fn": "mul", "args": [{ "fn": "attribute", "name": "moisture" }, 0.6] }] },
            { "fn": "add", "args": [0.6, { "fn": "mul", "args": [{ "fn": "attribute", "name": "moisture" }, 2.4] }] },
            { "fn": "attributeIs", "name": "species", "value": "pine" }
          ]
        }
      }
    }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["moisture", "in"] },
    { "from": ["moisture", "out"], "to": ["species", "in"] },
    { "from": ["species", "out"], "to": ["size", "in"] }
  ],
  "outputs": [{ "id": "size", "pin": "out", "name": "points" }]
}
`;export{e as default};