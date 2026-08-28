var e=`{\r
  "formatVersion": 1,\r
  "seed": 4127,\r
  "meta": {\r
    "title": "measure what runs under cover, where the route passes close to itself",\r
    "description": "\`pathCoverage\` casts REAL RAYS IN WORLD SPACE, and this graph is built out of the mistake that makes that necessary. The cheap way to ask how much of a route runs under cover is to project each piece of cover onto the route's arc length and add the windows up — and A BOUNDS PROJECTION ONTO A FOLDED CENTRELINE CANNOT TELL \`above the path here\` FROM \`near the path twice\`. Three such proxies gave 7.9%, 32.3% and 50.3% for one circuit, no two of them estimating the same quantity; the 32.3% was published and then withdrawn, because a single object near a hairpin had claimed 78 half-widths of lap for 6 half-widths of geometry. A SPIRAL IS THAT FAILURE MADE INTO A SHAPE: three turns out to a radius of 26, so every winding runs 8.7 units from the one inside it and a whole turn — a hundred units and more — from it along the path. Cover sits on the outermost winding only. The sample at (-21.5, 0, 1.7) has all six of its rays blocked; the sample at (-13.0, 0, 0.4) has none of them blocked, and neither does anything else on the inner coils — the largest hit count anywhere inside radius 19 is zero. Those two points are 8.6 apart in the world and 108.0 apart along the path. A path-relative window wide enough to reach the first would have swallowed the second. The rays cannot, because a fold is two different places in the world and one place in arc length.\\n\\nTHE MEASUREMENT CONVERGES, which is the property the three proxies lacked and the only reason to trust this one. 73 of the 311 evenly spaced samples are covered — 23.5% of the route — with the ceiling at 9; the same 23.5% with it at 18; the same at 40, because nothing else in this scene is overhead and raising the ceiling stops changing the answer. Halve the sample spacing and it is 23.7% over twice as many samples, so the figure is a property of the geometry rather than of how finely it was asked. But \`far\` IS LOAD-BEARING and has no unlimited setting: with an unbounded ray the sky is a tunnel and the answer is 100% everywhere, and set to 4 — below the canopy rather than above it — this graph reports nothing covered at all. Choose it for the scene, as the height at which something overhead has stopped being cover and started being scenery, and restate the number here rather than importing it from whatever placed the boxes: a figure whose whole value is that today's can be compared with yesterday's must not move when a placement rule is retuned.\\n\\nWHAT IS MEASURED IS EXACTLY WHAT IS DRAWN, and \`boxSize\` is how. A box's world extent is \`boxSize * scale\` componentwise: \`boxSize\` is the asset's own extent in its local frame and \`scale\` is the per-point multiplier \`spawnInstances\` puts in the matrix. The canopy spawns as \`panel\`, whose placeholder geometry is 0.42 by 0.3 by 0.66 and is centred on its point — which is where this node puts the box — so \`boxSize\` is written as exactly that triple and \`scale\` carries the multiplier, and the slab a ray meets is the slab on screen. GETTING THIS WRONG IS SILENT IN BOTH DIRECTIONS. Leave \`boxSize\` at its default [1, 1, 1], which is the honest reading for a cloud of unit cubes and the wrong one for this cloud, and every box inflates by one over the asset's own extent: the cook finishes cleanly and reports 32.8%. Forget \`scale\` instead and the boxes shrink and it reports no cover anywhere. Neither throws, and each leaves a plausible wrong number behind. Worth noting that \`occlusionCull\` reads the same three columns and has NO \`boxSize\` — there \`scale\` alone is the world extent, so the two nodes want the same cloud described two different ways.\\n\\nTHE CANOPY TAPERS, from 5.11 world units across at the start of its run to 0.30 at the end, and that is what turns \`minHits\` from a threshold into a picture. Selecting it and sizing it are the same question asked twice of the same quantity, the coil's own radius: \`filterByExpression\` keeps the stations outside 21, and \`remap\` narrows the panel linearly from there out to 26. The fan is 6 rays over -1.5..+1.5 WITH BOTH EDGES INCLUDED, so they sit at ±0.3, ±0.9 and ±1.5 across the path — a panel narrower than 3.0 stops reaching the outer pair, narrower than 1.8 the middle pair, narrower than 0.6 the inner pair. The count therefore walks 6, 4, 2 and 0 down the run as the panels close: 45 samples at 6, 24 at 4, 26 at 2, 208 at 0, and eight caught between bands where the coil curves out from under a panel's centreline. \`minHits\` 3 — half the fan, the shipped meaning of \`cover spans the corridor\` — cuts between 4 and 2, so THE COVERED STRETCH ENDS WELL BEFORE THE CANOPY DOES: it stops where the cover stopped spanning, not where the cover stopped existing. Ask for \`anything at all overhead\` with \`minHits\` 1 and 33.1% is covered; ask for edge to edge with 6 and 14.5% is. The threshold IS the definition, which is why \`hitsAttr\` writes the raw count as well — a graph still choosing what it means can compare against several thresholds downstream without casting again, and the colour ramp here reads that column rather than the flag.\\n\\n\`spread\` is HALF the fan's lateral span, and collapsing it to 0 is exactly the mistake \`rayCount\`'s own description names: one ray down the middle sees the span of a narrowing gantry and calls the whole thing a tunnel, and this graph duly reports 34.7% that way. \`across\` is perpendicular to both the cast direction and the path's own direction of travel, derived here from the route's POLYLINE TOPOLOGY — which is why an empty \`acrossAttr\` refuses a bare point cloud, and why the route reaches this node straight from \`pathResample\` rather than through anything that rebuilds the point domain. \`near\` at 1.2 is the floor that stops the road's own surface, and whatever lies on it, from counting as a roof over itself; nothing lies on this road, so it changes no answer here and is set for the reason rather than for the effect.\\n\\nTHIS NODE ADDS A COLUMN AND REMOVES NOTHING: the route goes in and the same route comes out — points, vertices, primitives, topology and every existing attribute — two columns wider. That is the opposite of the five point filters, which rebuild the point domain from the survivors and take the topology with them, so the order is MEASURE THEN FILTER. \`sheltered\` is a \`filterByExpression\` on the flag this node wrote, and it is a separate output so that the difference between measuring and cutting shows up in the counts: 311 points on the route against 73 in the cloud. The node is order-independent by construction — no point's answer depends on another's, no box's on another's, and nothing accumulates in floating point — and it is exactly cell-invariant under a partitioned cook given a halo of hypot(spread, max(|near|, |far|)) plus the largest box's bounding-sphere radius, about 12.6 units here.\\n\\nTHE PICTURE is the argument in one frame. Three coils; the outer one roofed by twenty-two panels that narrow as they go; that coil warm where the roof spans it, amber where it half spans it, cool where it has closed to a rib. The two coils inside — never more than nine units away, always a full turn behind — blue from end to end.",\r
    "tags": ["basics", "path", "coverage", "measure", "rays"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "coil",\r
      "type": "subgraph",\r
      "params": { "count": 320, "turns": 3, "size": [26, 1, 26] },\r
      "ref": { "name": "shape/spiral" }\r
    },\r
    {\r
      "id": "path",\r
      "type": "pointsToPath",\r
      "params": { "closed": false }\r
    },\r
    {\r
      "id": "lap",\r
      "type": "pathResample",\r
      "params": { "mode": "spacing", "spacing": 0.8 }\r
    },\r
    {\r
      "id": "stations",\r
      "type": "subgraph",\r
      "params": { "mode": "spacing", "spacing": 4, "axis": "+z" },\r
      "ref": { "name": "place/along-curve" }\r
    },\r
    {\r
      "id": "rim",\r
      "type": "filterByExpression",\r
      "params": {\r
        "predicate": {\r
          "fn": "gt",\r
          "args": [{ "fn": "length", "args": [{ "fn": "position" }] }, 21]\r
        }\r
      }\r
    },\r
    {\r
      "id": "panels",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "div",\r
              "args": [\r
                {\r
                  "fn": "clamp",\r
                  "args": [\r
                    {\r
                      "fn": "remap",\r
                      "args": [\r
                        { "fn": "length", "args": [{ "fn": "position" }] },\r
                        21,\r
                        26,\r
                        5.2,\r
                        0.3\r
                      ]\r
                    },\r
                    0.3,\r
                    5.2\r
                  ]\r
                },\r
                0.42\r
              ]\r
            },\r
            3,\r
            7\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "roof",\r
      "type": "transformPoints",\r
      "params": { "translate": [0, 5.5, 0] }\r
    },\r
    {\r
      "id": "cover",\r
      "type": "pathCoverage",\r
      "params": {\r
        "direction": [0, 1, 0],\r
        "near": 1.2,\r
        "far": 9,\r
        "rayCount": 6,\r
        "spread": 1.5,\r
        "minHits": 3,\r
        "acrossAttr": "",\r
        "boxSize": [0.42, 0.3, 0.66],\r
        "coveredAttr": "covered",\r
        "hitsAttr": "coverHits"\r
      }\r
    },\r
    {\r
      "id": "tint",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "color",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "ramp",\r
              "args": [{ "fn": "attribute", "name": "coverHits" }],\r
              "stops": [\r
                [0, 0.16],\r
                [2, 0.28],\r
                [4, 0.95],\r
                [6, 0.96]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [{ "fn": "attribute", "name": "coverHits" }],\r
              "stops": [\r
                [0, 0.42],\r
                [2, 0.7],\r
                [4, 0.72],\r
                [6, 0.34]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [{ "fn": "attribute", "name": "coverHits" }],\r
              "stops": [\r
                [0, 0.86],\r
                [2, 0.74],\r
                [4, 0.24],\r
                [6, 0.16]\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "sheltered",\r
      "type": "filterByExpression",\r
      "params": { "predicate": { "fn": "attribute", "name": "covered" } }\r
    },\r
    {\r
      "id": "canopy",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "panel" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["coil", "out"], "to": ["path", "in"] },\r
    { "from": ["path", "out"], "to": ["lap", "in"] },\r
    { "from": ["path", "out"], "to": ["stations", "curve"] },\r
    { "from": ["stations", "out"], "to": ["rim", "in"] },\r
    { "from": ["rim", "out"], "to": ["panels", "in"] },\r
    { "from": ["panels", "out"], "to": ["roof", "in"] },\r
    { "from": ["lap", "out"], "to": ["cover", "path"] },\r
    { "from": ["roof", "out"], "to": ["cover", "boxes"] },\r
    { "from": ["cover", "out"], "to": ["tint", "in"] },\r
    { "from": ["tint", "out"], "to": ["sheltered", "in"] },\r
    { "from": ["roof", "out"], "to": ["canopy", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "tint", "pin": "out", "name": "lap" },\r
    { "id": "sheltered", "pin": "out", "name": "sheltered" },\r
    { "id": "canopy", "pin": "instances", "name": "canopy" }\r
  ]\r
}\r
`;export{e as default};