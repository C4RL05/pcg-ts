var e=`{\r
  "formatVersion": 1,\r
  "seed": 3391,\r
  "meta": {\r
    "title": "clear a line of sight by moving the props, not by deleting them",\r
    "description": "\`occlusionCull\` is the only node in the library that MOVES a point as well as removing one, and this graph exists to show that the order of those two is the whole node rather than an optimisation inside it. Two identical culls run over the same 220 hoardings, differing in exactly one number. At \`pushMax\` 0 — the shipped default, and the conservative reading — every hoarding standing in the drivers' line of sight is deleted and 151 come out. At 8 the node first steps each blocker along \`pushAxis\` in half-unit rungs, keeps the first position that clears every chord, and drops only what it could not move: 220 come out. Same sight path, same swept band, same rule. The difference is 69 assets an author placed and a budget upstream counted. Dropping spends both, pushing spends neither, and that is why the default is 0 rather than something generous — 8 is a long way in a courtyard and nothing at all on a motorway, so a default distance would either do nothing or relocate an authored point by an amount nobody chose, and of the two failures the missing prop is the one an author notices.\\n\\nTHE SIGHT PATH IS A CLOSED LOOP because the case this node is for is a route, and a route bends. The eyes are the loop resampled at 3-unit spacing, 55 of them, raised 1.5 by \`eyeOffset\` while the TARGETS stay on the road — lift both ends and a low box slips under the chord that was supposed to catch it. \`lookAhead\` is 30 world units of ARC LENGTH, so the chords from an eye cut across the inside of the bend and dip to 26·cos(30/52), about 21.8 of the loop's own 26. That annulus, widened by a hoarding's half-diagonal, is the strip the two outputs sweep clean: neither has a single hoarding left between radius 22 and 25, because the cull is the same cull and only the repair differs. Cost is one test per (point, nearby eye, sample), so it scales with EYE DENSITY as much as with the cloud — resample the sight path to the spacing the rule needs rather than the spacing it happens to have, since at 0.1 this same loop would be over sixteen hundred eyes for the identical answer.\\n\\nWHY THE FAN IS TEN CHORDS AND NOT ONE, stated as a number the graph will produce: set \`samples\` to 1 and the pure cull keeps 156 instead of 151. Those five hoardings stand squarely across the middle of the look-ahead while leaving its far end in plain view, so a single chord to the end of the run misses them and the rule passes vacuously. The targets sit at \`lookAhead * i / samples\`, so the gap between them here is 3 units, and a box narrower than that gap can still slip between two chords and be kept. Raise \`samples\` until the gap is smaller than the narrowest thing that matters; lowering it is the cheapest way to make this node fast and the first thing to make it wrong.\\n\\n\`pushAxis\` IS A FIELD HERE, which is the form the param is really for. \`vec(P.x, 0, P.z)\` gives every hoarding the outward radial of the place it stands, which on a circular route is its lateral; only the DIRECTION is read, since the node normalizes it and chooses the sign itself, pushing whichever of ±axis takes the point further from the nearest eye. That is what lets one expression serve the inside of the loop, which moves inward, and the outside, which moves outward, with no sign written per point. Replace it with the plain \`[1, 0, 0]\` this param defaults to and 19 hoardings are dropped anyway — the ones at the north and south of the loop, where world X runs ALONG the sight line, so a point pushed along it never leaves it. A world axis stops being an approximation the moment the route turns. \`pushMax\` is a real distance and not a slider: at 4 instead of 8, 18 blockers cannot reach clear air and are dropped after all.\\n\\nWHAT IS TESTED IS WHAT WILL BE DRAWN: \`P\` is the box centre, \`rot\` its orientation, \`scale\` its FULL extents, and those are the same three columns \`spawnInstances\` reads. Note there is no \`boxSize\` param here as there is on \`pathCoverage\` — \`scale\` alone is the world size, so a cloud standing for an asset that is not unit-sized has to fold the asset's own extent into \`scale\` before this node sees it. A cloud with NO \`scale\` column is read as a box with no extent, which blocks nothing: the node becomes a visible no-op rather than an error, and that asymmetry is deliberate, since assuming a unit box would delete points on the strength of a size nobody wrote. \`write/random-yaw\` turns each 3.2 by 1.0 hoarding, and the slab test runs in each box's OWN frame: one that presents its narrow edge to the chords survives where its world-aligned hull would not. On a straight the hull and the box agree; through a bend they do not, which is exactly where the rule matters, so testing the hull would be checking the one case that never fails.\\n\\nBOTH CULLS RUN AT \`pushClearance\` 0, which is what lets this graph claim anything about order. Points are visited in an order fixed by point IDENTITY — the bits of the stored position plus the \`seed\` attribute — and never by array index, so shuffling the cloud, filtering something upstream, or deriving the same hoardings inside another cell's halo yields the identical survivor set. At 0 a verdict depends on the sight input and the point itself and on nothing else, so a partitioned cook is EXACT given a window of \`lookAhead\` plus \`pushMax\` plus the widest box half-diagonal, about 40 units here. Raise it and each pushed point begins avoiding the ones already settled, which is a chain no halo width covers: the answer is still the same answer on every run, but a per-cell cook stops agreeing with a whole-region one and the disagreement shows up as pushed points overlapping at the seams rather than as an error. It is the knob to reach for when the pushed points land in a heap; on this scene they do not, because the 69 of them spread over an annulus 120 units around.\\n\\nTOPOLOGY DOES NOT SURVIVE under any setting, and unlike the five point filters there is no \`topology: keep\` to ask for it — a primitive kept over a MOVED point would describe a shape nobody authored, a road that follows its lamp posts sideways. Rebuild with \`pointsToPath\` or \`connectPoints\`. One consequence worth stating because nothing else will say it: a pushed point comes out with a different \`P\`, and \`P\` is half of a point's identity, so anything identity-keyed downstream re-rolls for exactly the points that moved.\\n\\nTHE TWO SCENES ARE ONE SCENE, translated 92 units apart so they can be read side by side, and the loop under each is the same sight path. Read the band. On the left it is empty and the hoardings that stood in it are gone; on the right it is just as empty, and they are standing along both of its edges.",\r
    "tags": ["basics", "visibility", "filter", "placement"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "loop",\r
      "type": "subgraph",\r
      "params": { "count": 72, "size": [26, 1, 26] },\r
      "ref": { "name": "shape/path-loop" }\r
    },\r
    {\r
      "id": "eyes",\r
      "type": "pathResample",\r
      "params": { "mode": "spacing", "spacing": 3 }\r
    },\r
    {\r
      "id": "props",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 220,\r
        "boundsMin": [-30, 1.8, -30],\r
        "boundsMax": [30, 1.8, 30]\r
      }\r
    },\r
    {\r
      "id": "yaw",\r
      "type": "subgraph",\r
      "params": { "axis": "+z" },\r
      "ref": { "name": "write/random-yaw" }\r
    },\r
    {\r
      "id": "hoarding",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": { "fn": "constant", "value": [3.2, 3.6, 1.0] }\r
      }\r
    },\r
    {\r
      "id": "drop",\r
      "type": "occlusionCull",\r
      "params": {\r
        "lookAhead": 30,\r
        "samples": 10,\r
        "eyeOffset": [0, 1.5, 0],\r
        "pushAxis": {\r
          "fn": "vec",\r
          "args": [\r
            { "fn": "component", "args": [{ "fn": "position" }], "index": 0 },\r
            0,\r
            { "fn": "component", "args": [{ "fn": "position" }], "index": 2 }\r
          ]\r
        },\r
        "pushMax": 0,\r
        "pushStep": 0.5,\r
        "pushClearance": 0\r
      }\r
    },\r
    {\r
      "id": "push",\r
      "type": "occlusionCull",\r
      "params": {\r
        "lookAhead": 30,\r
        "samples": 10,\r
        "eyeOffset": [0, 1.5, 0],\r
        "pushAxis": {\r
          "fn": "vec",\r
          "args": [\r
            { "fn": "component", "args": [{ "fn": "position" }], "index": 0 },\r
            0,\r
            { "fn": "component", "args": [{ "fn": "position" }], "index": 2 }\r
          ]\r
        },\r
        "pushMax": 8,\r
        "pushStep": 0.5,\r
        "pushClearance": 0\r
      }\r
    },\r
    {\r
      "id": "dropShift",\r
      "type": "transformPoints",\r
      "params": { "translate": [-92, 0, 0] }\r
    },\r
    {\r
      "id": "roadLeft",\r
      "type": "transformPoints",\r
      "params": { "translate": [-92, 0, 0] }\r
    },\r
    { "id": "roads", "type": "mergePrimitives", "params": {} },\r
    {\r
      "id": "spawnDrop",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "panel" }\r
    },\r
    {\r
      "id": "spawnPush",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "panel" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["loop", "out"], "to": ["eyes", "in"] },\r
    { "from": ["props", "out"], "to": ["yaw", "in"] },\r
    { "from": ["yaw", "out"], "to": ["hoarding", "in"] },\r
\r
    { "from": ["hoarding", "out"], "to": ["drop", "in"] },\r
    { "from": ["eyes", "out"], "to": ["drop", "sight"] },\r
    { "from": ["hoarding", "out"], "to": ["push", "in"] },\r
    { "from": ["eyes", "out"], "to": ["push", "sight"] },\r
\r
    { "from": ["drop", "out"], "to": ["dropShift", "in"] },\r
    { "from": ["eyes", "out"], "to": ["roadLeft", "in"] },\r
    { "from": ["roadLeft", "out"], "to": ["roads", "in"] },\r
    { "from": ["eyes", "out"], "to": ["roads", "in"] },\r
\r
    { "from": ["dropShift", "out"], "to": ["spawnDrop", "in"] },\r
    { "from": ["push", "out"], "to": ["spawnPush", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "roads", "pin": "out", "name": "roads" },\r
    { "id": "spawnDrop", "pin": "instances", "name": "dropped" },\r
    { "id": "spawnPush", "pin": "instances", "name": "pushed" }\r
  ]\r
}\r
`;export{e as default};