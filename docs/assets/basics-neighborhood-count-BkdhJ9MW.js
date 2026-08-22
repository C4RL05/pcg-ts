var e=`{
  "formatVersion": 1,
  "seed": 1018,
  "meta": {
    "title": "measure how crowded each point is",
    "description": "\`pointNeighborhood\` writes how many other points lie within \`radius\` into a u32 attribute, using a uniform spatial grid so it stays fast well beyond a few thousand points. The count is a measured quantity rather than an authored one, which is what a later filter, colour or scale can react to. A point with no neighbours gets 0 and keeps its own value as the neighbour average, so a displacement built from that average is zero rather than undefined.",
    "tags": ["basics", "attributes", "neighborhood", "measure"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInBounds",
      "params": {
        "count": 700,
        "boundsMin": [-25, 0, -25],
        "boundsMax": [25, 0, 25]
      }
    },
    {
      "id": "crowding",
      "type": "pointNeighborhood",
      "params": { "radius": 4, "countAttr": "nbrCount" }
    }
  ],
  "connections": [{ "from": ["scatter", "out"], "to": ["crowding", "in"] }],
  "outputs": [{ "id": "crowding", "pin": "out", "name": "points" }]
}
`;export{e as default};