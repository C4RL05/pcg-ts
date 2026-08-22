var e=`{\r
  "formatVersion": 1,\r
  "seed": 20260816,\r
  "meta": {\r
    "title": "one cell of a streamed world, halo and all",\r
    "description": "The corpus graph a \`World\` can BIND, not just cook: every per-cell quantity is an ordinary top-level node param, so \`bindPatches\` reaches it as plain JSON and the level can cook on a worker. Its defaults are not a picture, they are the RECTANGLE OF ONE CELL: cell [0, 0] of a 64-unit level, which is [0, 64) on both axes, queried with the 4-unit halo it needs (the scatter window runs -4 to 68) and clipped back to what it owns. Note where that box is NOT — a cell is always [c*size, (c+1)*size), so no cell is ever centred on the origin, and a graph whose default box straddles it is quietly claiming to be a window rather than a cell. What a bind still supplies is the SEEDS: standalone they are the literals below, while a World writes ctx.worldSeed and salts of it, so the standalone cook shows this cell's geometry and mechanism rather than any particular world's bytes. Four seam hazards are wired on purpose. (1) The source is \`pointScatterInWorld\` — \`basics-scatter-in-world\` teaches it alone — whose lattice is a function of its own \`seed\` and never of the graph seed, so bind hands it a cell-INVARIANT \`ctx.worldSeed\` and varies only \`boundsMin\`/\`boundsMax\`. (2) The density noise carries a LITERAL \`seed\` inside its spec instead of \`{ \\"from\\": \\"node\\", \\"variant\\": 0 }\`, because a nodeSeed-folded noise 'samples a different region in every cell, so it must not feed anything that has to agree across a seam' (src/nodes/attributes.ts) — which is exactly what \`basics-reseed-a-noise\` wires up, and exactly what a level graph must not. (3) \`pointNeighborhood\` is the ONE-HOP rung: exact at a halo of \`radius\` and at no smaller width, so bind widens the scatter window by exactly 4 units and by nothing more. (4) \`filterByBounds\` at its default half-open boundary is the OWNERSHIP rule, bound from the UNWIDENED cell, because 'the exactness comes from the two cells sharing an endpoint value' — 'compare against the box, not against a recomputed index', since \`floor(67.8 / 0.1)\` is 677 while \`678 * 0.1\` is exactly 67.8 (docs/authoring.md). Its Y bounds are a finite +/-1e6 rather than infinities, which do not survive JSON and cannot be patched, and which an 'xz' World column does not bound anyway. \`filterByDensity\` and the \`randomField\` inside \`size\` both draw on their node seed, which the GRAPH seed does reach, so a per-cell \`graph.setSeed\` (or a \`bindPatches\` \`seed\`) would move them and 'the halo and the neighbour disagree, deterministically and silently' (src/runtime/types.ts); bind seeds them cell-invariantly and never reseeds the graph. The second output, \`populationRank\`, is the counter-example kept deliberately: a \`fraction\` field measures the population present in THIS cook, which under a World means the population HERE, so it is the unbounded rung no halo width can repair and the one thing in this graph a partitioned cook is not allowed to agree about.",\r
    "tags": ["examples", "world", "streaming", "halo", "determinism"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInWorld",\r
      "params": {\r
        "density": 0.5,\r
        "cellSize": 7,\r
        "latticeMode": "xz",\r
        "height": 0,\r
        "boundsMin": [-4, 0, -4],\r
        "boundsMax": [68, 0, 68],\r
        "seed": 20259\r
      }\r
    },\r
    {\r
      "id": "density",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "density",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "clamp",\r
          "args": [\r
            {\r
              "fn": "remap",\r
              "args": [\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": 7717,\r
                    "frequency": 0.035,\r
                    "octaves": 3,\r
                    "gain": 0.5,\r
                    "normalized": true,\r
                    "position": { "fn": "position" }\r
                  }\r
                },\r
                0.3,\r
                0.8,\r
                0,\r
                1\r
              ]\r
            },\r
            0,\r
            1\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "thin",\r
      "type": "filterByDensity",\r
      "params": { "mode": "probabilistic", "seed": 0 }\r
    },\r
    {\r
      "id": "crowding",\r
      "type": "pointNeighborhood",\r
      "params": { "radius": 4, "countAttr": "nbrCount" }\r
    },\r
    {\r
      "id": "own",\r
      "type": "filterByBounds",\r
      "params": {\r
        "mode": "inside",\r
        "boundary": "halfOpen",\r
        "boundsMin": [0, -1000000, 0],\r
        "boundsMax": [64, 1000000, 64]\r
      }\r
    },\r
    {\r
      "id": "size",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "size",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "remap",\r
              "args": [\r
                {\r
                  "fn": "clamp",\r
                  "args": [{ "fn": "attribute", "name": "nbrCount" }, 2, 16]\r
                },\r
                2,\r
                16,\r
                0.4,\r
                1.35\r
              ]\r
            },\r
            {\r
              "fn": "remap",\r
              "args": [{ "fn": "randomField", "key": "size" }, 0, 1, 0.85, 1.15]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "rank",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "cookRank",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": { "fn": "fraction" }\r
      }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["density", "in"] },\r
    { "from": ["density", "out"], "to": ["thin", "in"] },\r
    { "from": ["thin", "out"], "to": ["crowding", "in"] },\r
    { "from": ["crowding", "out"], "to": ["own", "in"] },\r
    { "from": ["own", "out"], "to": ["size", "in"] },\r
    { "from": ["own", "out"], "to": ["rank", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "size", "pin": "out", "name": "points" },\r
    { "id": "rank", "pin": "out", "name": "populationRank" }\r
  ]\r
}\r
`;export{e as default};