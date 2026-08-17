var e=`{\r
  "formatVersion": 1,\r
  "seed": 20260816,\r
  "meta": {\r
    "title": "Riverbank",\r
    "description": "Distance to a FEATURE as the thing that shapes everything else, which several graphs use in passing and none is named for. A straight line of points is pushed sideways by a noise and pathed into a river, \`splineSample\` walks it at even spacing, and \`sampleNearestPoint\` writes each ground point's distance to the nearest of those samples into \`riverDist\` — one attribute that then drives three separate decisions: \`filterByExpression\` thins the trees near the water, their \`scale\` rises with it, and the driftwood is placed on the river's own samples rather than on the ground at all, pushed to the bank along the curve normal and turned to the \`tangent\` that \`splineSample\` already wrote. Measured across three equal-area distance bands, tree counts run 163, 256, 289 outward and mean scale 0.53, 0.81, 1.03, 1.22 — the falloff is in the numbers, not only in the picture. IT WAS AUTHORED BY AN AGENT THAT COULD NOT READ THIS REPOSITORY, and that is why it is here. Given only \`pcg nodes\`, \`pcg fields\`, \`pcg validate\` and \`pcg inspect\` — no source, no docs, no other graph, not even for the file format — it reverse-engineered the format in eight \`validate\` probes and reached a clean cook on its second write. What it could NOT learn from the catalog is what got fixed because of it: the field catalog published type signatures with no semantics, the noise output ranges the library already knew were never printed, and nothing warned that gradient noise is exactly zero on the integer lattice. The hand-rolled perpendicular it wrote in \`driftToBank\` — nine nested objects deep, because the grammar had no \`cross\` — is what put \`cross\` in the grammar, and \`driftToBank\` now reads as the single call it always meant. Byte-identical output, checked against a control that moves when the operands are swapped: the graph is unchanged and only its spelling of the idea got shorter. THE FOUR ASSET IDS IT INVENTED were the other thing it could not discover: \`tree_pine\`, \`tree_birch\`, \`tree_willow\` and \`driftwood_log\` cooked, validated and reported their instance counts while rendering as anonymous stand-ins, because an asset id is a free string and nothing checked it. They are the shared vocabulary's \`pine\`, \`birch\`, \`willow\` and \`log\` now, and \`pcg assets <graph.json>\` is what makes that checkable rather than a thing you notice in a picture.",\r
    "tags": ["river", "scatter", "distance-falloff", "path", "spawn"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ground",\r
      "type": "meshPrimitive",\r
      "params": {\r
        "shape": "plane",\r
        "orientation": "xz",\r
        "size": [150, 0, 150],\r
        "center": [0, 0, 0],\r
        "subdivisions": [24, 1, 24]\r
      }\r
    },\r
    {\r
      "id": "riverSpine",\r
      "type": "pointLine",\r
      "params": {\r
        "mode": "endpoints",\r
        "count": 48,\r
        "start": [-78, 0, 0],\r
        "end": [78, 0, 0]\r
      }\r
    },\r
    {\r
      "id": "riverMeander",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "P",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            { "fn": "component", "args": [{ "fn": "position" }], "index": 0 },\r
            0,\r
            {\r
              "fn": "add",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "simplexNoise",\r
                      "opts": { "seed": 91, "frequency": 0.011, "offset": [0, 10.37, 4.61] }\r
                    },\r
                    46\r
                  ]\r
                },\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "simplexNoise",\r
                      "opts": { "seed": 17, "frequency": 0.043, "offset": [0, 3.19, 7.53] }\r
                    },\r
                    9\r
                  ]\r
                }\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "riverPath",\r
      "type": "pointsToPath",\r
      "params": { "closed": false }\r
    },\r
    {\r
      "id": "riverCentre",\r
      "type": "splineSample",\r
      "params": { "mode": "spacing", "spacing": 1.2 }\r
    },\r
    {\r
      "id": "groundSeeds",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 9000,\r
        "boundsMin": [-72, 0, -72],\r
        "boundsMax": [72, 0, 72],\r
        "seed": 41\r
      }\r
    },\r
    {\r
      "id": "groundDist",\r
      "type": "sampleNearestPoint",\r
      "params": { "distanceAttr": "riverDist" }\r
    },\r
    {\r
      "id": "treeThin",\r
      "type": "filterByExpression",\r
      "params": {\r
        "predicate": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "ge",\r
              "args": [{ "fn": "attribute", "name": "riverDist" }, 4.5]\r
            },\r
            {\r
              "fn": "lt",\r
              "args": [\r
                { "fn": "randomField", "key": "thin" },\r
                {\r
                  "fn": "ramp",\r
                  "args": [{ "fn": "attribute", "name": "riverDist" }],\r
                  "stops": [[4.5, 0.02], [14, 0.3], [34, 1]]\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "seed": 5\r
      }\r
    },\r
    {\r
      "id": "treeSpacing",\r
      "type": "selfPrune",\r
      "params": { "minDistance": 2.4 }\r
    },\r
    {\r
      "id": "treeScale",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "ramp",\r
              "args": [{ "fn": "attribute", "name": "riverDist" }],\r
              "stops": [[4.5, 0.3], [16, 0.72], [40, 1.25]]\r
            },\r
            {\r
              "fn": "add",\r
              "args": [0.8, { "fn": "mul", "args": [{ "fn": "randomField", "key": "size" }, 0.4] }]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "treeSpecies",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "asset",\r
        "domain": "point",\r
        "type": "string",\r
        "values": ["pine", "birch", "willow"],\r
        "weights": [5, 3, 2],\r
        "select": { "fn": "randomField", "key": "species" }\r
      }\r
    },\r
    {\r
      "id": "trees",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "pine", "assetAttr": "asset" }\r
    },\r
    {\r
      "id": "driftSeeds",\r
      "type": "splineSample",\r
      "params": { "mode": "spacing", "spacing": 1.3 }\r
    },\r
    {\r
      "id": "driftThin",\r
      "type": "filterByExpression",\r
      "params": {\r
        "predicate": {\r
          "fn": "lt",\r
          "args": [{ "fn": "randomField", "key": "drift" }, 0.55]\r
        },\r
        "seed": 9\r
      }\r
    },\r
    {\r
      "id": "driftToBank",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "P",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "add",\r
          "args": [\r
            { "fn": "position" },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "cross",\r
                  "args": [{ "fn": "attribute", "name": "tangent", "tupleSize": 3 }, [0, 1, 0]]\r
                },\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "select",\r
                      "args": [{ "fn": "gt", "args": [{ "fn": "randomField", "key": "side" }, 0.5] }, 1, -1]\r
                    },\r
                    {\r
                      "fn": "add",\r
                      "args": [3.2, { "fn": "mul", "args": [{ "fn": "randomField", "key": "bank" }, 2.6] }]\r
                    }\r
                  ]\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "seed": 3\r
      }\r
    },\r
    {\r
      "id": "driftOrient",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": { "fn": "attribute", "name": "tangent", "tupleSize": 3 },\r
        "up": [0, 1, 0],\r
        "axis": "+z"\r
      }\r
    },\r
    {\r
      "id": "driftScale",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "add",\r
          "args": [0.55, { "fn": "mul", "args": [{ "fn": "randomField", "key": "dsize" }, 0.9] }]\r
        }\r
      }\r
    },\r
    {\r
      "id": "driftwood",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "log" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["riverSpine", "out"], "to": ["riverMeander", "in"] },\r
    { "from": ["riverMeander", "out"], "to": ["riverPath", "in"] },\r
    { "from": ["riverPath", "out"], "to": ["riverCentre", "in"] },\r
    { "from": ["groundSeeds", "out"], "to": ["groundDist", "in"] },\r
    { "from": ["riverCentre", "out"], "to": ["groundDist", "source"] },\r
    { "from": ["groundDist", "out"], "to": ["treeThin", "in"] },\r
    { "from": ["treeThin", "out"], "to": ["treeSpacing", "in"] },\r
    { "from": ["treeSpacing", "out"], "to": ["treeScale", "in"] },\r
    { "from": ["treeScale", "out"], "to": ["treeSpecies", "in"] },\r
    { "from": ["treeSpecies", "out"], "to": ["trees", "in"] },\r
    { "from": ["riverPath", "out"], "to": ["driftSeeds", "in"] },\r
    { "from": ["driftSeeds", "out"], "to": ["driftThin", "in"] },\r
    { "from": ["driftThin", "out"], "to": ["driftToBank", "in"] },\r
    { "from": ["driftToBank", "out"], "to": ["driftOrient", "in"] },\r
    { "from": ["driftOrient", "out"], "to": ["driftScale", "in"] },\r
    { "from": ["driftScale", "out"], "to": ["driftwood", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "trees", "pin": "instances", "name": "trees" },\r
    { "id": "driftwood", "pin": "instances", "name": "driftwood" },\r
    { "id": "riverPath", "pin": "out", "name": "river" },\r
    { "id": "ground", "pin": "out", "name": "ground" }\r
  ]\r
}\r
`;export{e as default};