var e=`{
  "formatVersion": 1,
  "seed": 1029,
  "meta": {
    "title": "scatter points anchored to the world, not to the box",
    "description": "The same shape of graph as 'scatter points in a box', with the one difference that makes a region streamable: \`pointScatterInWorld\` computes each point from its own lattice cell and index, so the box only says which points to RETURN. Widen it, move it, or ask for it in four pieces and every point that was already there stays exactly where it was, with the same per-point seed — \`pointScatterInBounds\` derives positions FROM the bounds and moves all 500 of them when the box moves an inch. Population is \`density * area\`: at 0.05 points per square unit over an 80x80 window that is 320 points, predictable without cooking, with \`cellSize\` deciding only how evenly they clump. The clip is half-open, so abutting windows tile the world with no gap and no duplicate — which is why a cell can derive its own halo by simply asking for a wider box.",
    "tags": ["basics", "scatter", "source", "streaming"]
  },
  "nodes": [
    {
      "id": "scatter",
      "type": "pointScatterInWorld",
      "params": {
        "density": 0.05,
        "cellSize": 10,
        "latticeMode": "xz",
        "boundsMin": [-40, 0, -40],
        "boundsMax": [40, 0, 40]
      }
    }
  ],
  "connections": [],
  "outputs": [{ "id": "scatter", "pin": "out", "name": "points" }]
}
`;export{e as default};