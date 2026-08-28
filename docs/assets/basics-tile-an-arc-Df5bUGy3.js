var e=`{\r
  "formatVersion": 1,\r
  "seed": 4139,\r
  "meta": {\r
    "title": "tile a repeated piece over three stretches of one lap, choosing the piece once per stretch",\r
    "description": "ENCLOSURE IS A PATTERN, NOT AN ASSET. On the most enclosed of twenty-two measured circuits the cover overhead is held up by 126 separate objects, and the largest single one accounts for 5.9% of it — the workhorse is one strip placed 24 times. There is no tunnel model to find and place; there is a run of repeated pieces over an arc range, and \`arcTile\` is the node that builds one. The ranges arrive as a SECOND GEOMETRY rather than as params: there are many of them and each carries its own decisions — where it starts, how long it is, which piece it is made of, how wide, which variant — and a param is one value for the whole cook. Three ranges here, hand-written as three points, become 48 tiles in three batches.\\n\\nTHE PIECE IS CHOSEN ONCE PER RANGE, AND THAT IS THE WHOLE POINT. The draw happens on the ranges cloud, where there is exactly ONE element per stretch to draw on: \`randomField\` picks 0, 1 or 2, and that one number decides the asset id, the colour and the piece's length. \`rangeNames\` then COPIES those columns, unchanged, onto every tile of that range. Copying is what makes a run atomic. Move the same \`setAttribute\` downstream of \`arcTile\` and it becomes 48 draws instead of 3: every stretch turns into a speckle of all three assets, which is still 48 instances of the same vocabulary and is no longer three covered stretches. A per-tile draw can be uniform only by luck, and only until someone changes the seed — the case this node comes from measured a planned 17-unit covered stretch back as 8 the moment poses were drawn per piece, because varying the shape along a run reopens the seams the overlap existed to close.\\n\\nTHE COLOUR IS CALLED \`rangeColor\` AND NOT \`color\` ON PURPOSE. \`color\` is one of the names \`arcTile\` writes on every tile itself, and \`rangeNames\` REFUSES such a name rather than resolving it quietly, because carrying it would delete what the node wrote and the cook would look entirely fine afterwards. So the per-range decision is written under a name the node does not own, and \`spawnInstances\` is pointed at that name directly — nothing is picked up automatically, and an attribute never named in \`colorAttr\` is silently not drawn. The picture is the test of the whole paragraph above: each stretch is one solid colour, and the three colours differ.\\n\\nSPACING IS A CEILING ON THE PITCH, NOT THE PITCH, and here it is a FIELD so the pitch can follow the piece. Each range writes \`pieceLen\` beside its asset id and \`arcTile\` resolves \`spacing\` on the ranges' POINT domain, so an 8-unit gantry, a 5-unit arch and a 2-unit rib tile at their own pitches in ONE cook, each reading the size its own range chose. A range of length L takes max(1, ceil(L / spacing)) tiles at the centres of that many equal sub-intervals, so the step is L / count and is at most \`spacing\`, never more: the 52-unit arch range takes 11 tiles at a pitch of 4.727, the 66-unit gantry range 9 at 7.333, the 55-unit rib range 28 at 1.964. Rounded UP, not to nearest, so that pieces meant to abut do — nearest would have given the arch range 10 tiles at 5.200, which is a fifth of a unit of daylight at every joint and two units of it over the range, and a gap in a tiled cover is not a near-miss but a hole. Nothing here knows how big your piece is, which is why OVERLAP is spelled as a spacing SMALLER than the piece; about 5% under closes the wedge two pieces leave on the outside of a bend.\\n\\nTHE MOUTHS FLARE. \`flare\` is the arc distance over which each end opens and \`taper\` the scale the very mouth reaches, taken from whichever mouth is nearer, and it is applied to the two \`scale\` components that are NOT \`axis\` — the cross-section opens while the length along the path is left alone, since scaling all three would make the mouth pieces longer as well as wider and open the seams between them. With flare 6 and taper 1.6, the first arch tile sits 2.36 into its range, so its ramp is 0.606 and its scale comes out [1.364, 1.364, 1]: opened across, untouched along. A cover that starts at full section is a wall with a hole in it; the eye reads an opening from the way the section grows, and the flare is what keeps the view clear at the moment of entry, which is the moment it matters. When a mouth should do something else — lift, tilt, swap to a wider variant, fade a material — \`flareAttr\` writes the raw 0..1 ramp and leaves the doing to the asset.\\n\\nTHE SEAM IS NOT A BOUNDARY. The rib range starts at 285 on a lap of 314.03 and runs 55, so it crosses the start/finish line, and on a CLOSED path that is one range whose arc is taken modulo the path's length — the same answer \`pathRuns\` and \`runFit\` give a run there. Its 28 ribs step from 285.98 through 313.48 to 1.41 and on to 24.98, 1.964 apart the whole way including across the line: no double tile, no gap. On an OPEN path that range would be REFUSED rather than clamped, because a clamped range is a shorter tunnel than the one that was planned, reported as a success. The ranges are hand-written here because the point of the graph is WHERE the decision is made, and three points make that unmistakable — but any cloud will do, and \`startAttr\` and \`lengthAttr\` default to \`runStart\` and \`runSpan\`, which are \`runFit\`'s own default output names: filter a fitted path down to \`runIndex == 0\` and each survivor is one point carrying its run's start and span, which is a ranges cloud (see \`basics-fit-runs\`). The output is a plain CLOUD and not a path — the tiles are placements along the curve, not the curve — so the second output is the lap itself, to read them against.",\r
    "tags": ["basics", "path", "tiling", "instancing", "closed"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "loop",\r
      "type": "subgraph",\r
      "params": { "count": 64, "size": [50, 50, 50] },\r
      "ref": { "name": "shape/path-loop" }\r
    },\r
    {\r
      "id": "ranges",\r
      "type": "pointLine",\r
      "params": { "mode": "endpoints", "count": 3, "start": [0, 0, 0], "end": [4, 0, 0], "includeEnd": true }\r
    },\r
    {\r
      "id": "starts",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "runStart",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "select",\r
          "args": [\r
            { "fn": "lt", "args": [{ "fn": "index" }, 0.5] },\r
            40,\r
            {\r
              "fn": "select",\r
              "args": [{ "fn": "lt", "args": [{ "fn": "index" }, 1.5] }, 130, 285]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "spans",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "runSpan",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "select",\r
          "args": [\r
            { "fn": "lt", "args": [{ "fn": "index" }, 0.5] },\r
            52,\r
            {\r
              "fn": "select",\r
              "args": [{ "fn": "lt", "args": [{ "fn": "index" }, 1.5] }, 66, 55]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "pick",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "pick",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "floor",\r
          "args": [{ "fn": "mul", "args": [{ "fn": "randomField", "key": "piece" }, 3] }]\r
        }\r
      }\r
    },\r
    {\r
      "id": "asset",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "asset",\r
        "type": "string",\r
        "values": ["rib", "arch", "gantry"],\r
        "value": { "fn": "attribute", "name": "pick" }\r
      }\r
    },\r
    {\r
      "id": "pieceLen",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "pieceLen",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "select",\r
          "args": [\r
            { "fn": "lt", "args": [{ "fn": "attribute", "name": "pick" }, 0.5] },\r
            2,\r
            {\r
              "fn": "select",\r
              "args": [{ "fn": "lt", "args": [{ "fn": "attribute", "name": "pick" }, 1.5] }, 5, 8]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "hue",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "rangeColor",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "select",\r
          "args": [\r
            { "fn": "lt", "args": [{ "fn": "attribute", "name": "pick" }, 0.5] },\r
            { "fn": "vec", "args": [0.95, 0.5, 0.15] },\r
            {\r
              "fn": "select",\r
              "args": [\r
                { "fn": "lt", "args": [{ "fn": "attribute", "name": "pick" }, 1.5] },\r
                { "fn": "vec", "args": [0.2, 0.6, 0.95] },\r
                { "fn": "vec", "args": [0.45, 0.85, 0.3] }\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "cover",\r
      "type": "arcTile",\r
      "params": {\r
        "startAttr": "runStart",\r
        "lengthAttr": "runSpan",\r
        "spacing": { "fn": "attribute", "name": "pieceLen" },\r
        "flare": 6,\r
        "taper": 1.6,\r
        "axis": "+z",\r
        "rangeNames": ["asset", "rangeColor"]\r
      }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "rib", "assetAttr": "asset", "colorAttr": "rangeColor" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["ranges", "out"], "to": ["starts", "in"] },\r
    { "from": ["starts", "out"], "to": ["spans", "in"] },\r
    { "from": ["spans", "out"], "to": ["pick", "in"] },\r
    { "from": ["pick", "out"], "to": ["asset", "in"] },\r
    { "from": ["asset", "out"], "to": ["pieceLen", "in"] },\r
    { "from": ["pieceLen", "out"], "to": ["hue", "in"] },\r
    { "from": ["loop", "out"], "to": ["cover", "path"] },\r
    { "from": ["hue", "out"], "to": ["cover", "ranges"] },\r
    { "from": ["cover", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "loop", "pin": "out", "name": "road" },\r
    { "id": "spawn", "pin": "instances", "name": "cover" }\r
  ]\r
}\r
`;export{e as default};