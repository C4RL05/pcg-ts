var e=`{\r
  "formatVersion": 1,\r
  "seed": 6607,\r
  "meta": {\r
    "title": "draw the chain between scattered beads, from nothing but each one's successor",\r
    "description": "TWENTY-FOUR BEADS AT RANDOM ARC POSITIONS, AND THE LINKS BETWEEN THEM. Every link here is built from one fact: where the NEXT bead is. \`pathShift\` reads it — the beads are ordered into a closed ring by \`pointsToPath\`, and each one is handed its successor's \`P\` under the name \`nextP\`. A link is then just the vector between the two: \`orientAlongVector\` aims it, and \`distance\` sizes it. Nothing measures the curve, and nothing counts anything.\\n\\nWHY THIS NEEDED A NODE. \\"What does the element next to me carry\\" had no spelling. \`pathScan\` and \`pathRuns\` are prefix sums — they accumulate ALONG the order but cannot hand one element another's value. \`transferByIndex\` gathers by an ABSOLUTE point index, which is not the same question: the beads are stored in the order they were scattered, and the ring visits them in the order of their arc positions, so point 7's successor is whatever point happens to sit next round the lap, not point 8. \`pathSegments\` does draw one thing per segment, but it emits a SEPARATE cloud and explicitly drops the input's point attributes, so what it makes cannot be a bead that knows anything about itself. \`transferAlongPath\` reads at an arc position, not at an ordinal neighbour.\\n\\nTHE CLOSING LINK IS THE TEST OF IT. \`outOfRange: \\"wrap\\"\` is what makes the last bead's successor the first one, so the ring closes and there are twenty-four links for twenty-four beads rather than twenty-three and a gap. Set it to \\"clamp\\" and the last bead points at itself, giving a zero-length link; set it to \\"miss\\" and it keeps the default, which for \`nextP\` is the origin — so the last link stretches to the middle of the world, which is exactly the kind of wrong that looks like a rendering bug rather than a policy choice. Pick the one you mean.\\n\\nWRAP IS A POLICY, NOT A PROPERTY OF THE PATH. A closed polyline changes the ring's COUNT — its last position has a successor where an open one's does not — but it does not change which policy applies. An open path under \\"wrap\\" still comes round to its own start, because the question is what an ordinal past the end of a list should do, and a list has ends whether or not a segment joins them.\\n\\nTHE BEADS ARE UNEVENLY SPACED ON PURPOSE. \`pointScatterOnPath\` draws twenty-four arc positions at random, so the links differ in length and the picture shows the shift doing real work. Evenly-spaced beads would draw the same chain whether the successor lookup were right or off by one.",\r
    "tags": ["basics", "path", "curve", "closed", "attributes", "instancing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "loop",\r
      "type": "subgraph",\r
      "params": { "count": 96, "size": [16, 16, 16] },\r
      "ref": { "name": "shape/path-loop" }\r
    },\r
    {\r
      "id": "measure",\r
      "type": "pathResample",\r
      "params": { "mode": "count", "count": 96, "lengthAttr": "lapLen" }\r
    },\r
    {\r
      "id": "beads",\r
      "type": "pointScatterOnPath",\r
      "params": { "count": 24, "arcAttr": "station", "seed": 4 }\r
    },\r
    {\r
      "id": "ring",\r
      "type": "pointsToPath",\r
      "params": { "closed": true, "orderAttr": "station" }\r
    },\r
    {\r
      "id": "shift",\r
      "type": "pathShift",\r
      "params": {\r
        "attributes": ["P"],\r
        "outNames": ["nextP"],\r
        "offset": 1,\r
        "outOfRange": "wrap"\r
      }\r
    },\r
    {\r
      "id": "aim",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": {\r
          "fn": "sub",\r
          "args": [{ "fn": "attribute", "name": "nextP", "tupleSize": 3 }, { "fn": "position" }]\r
        },\r
        "up": [0, 1, 0],\r
        "axis": "+y"\r
      }\r
    },\r
    {\r
      "id": "size",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            0.35,\r
            {\r
              "fn": "distance",\r
              "args": [\r
                { "fn": "position" },\r
                { "fn": "attribute", "name": "nextP", "tupleSize": 3 }\r
              ]\r
            },\r
            0.35\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "link" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["loop", "out"], "to": ["measure", "in"] },\r
    { "from": ["measure", "out"], "to": ["beads", "path"] },\r
    { "from": ["beads", "out"], "to": ["ring", "in"] },\r
    { "from": ["ring", "out"], "to": ["shift", "in"] },\r
    { "from": ["shift", "out"], "to": ["aim", "in"] },\r
    { "from": ["aim", "out"], "to": ["size", "in"] },\r
    { "from": ["size", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "measure", "pin": "out", "name": "loop" },\r
    { "id": "spawn", "pin": "instances", "name": "chain" }\r
  ]\r
}\r
`;export{e as default};