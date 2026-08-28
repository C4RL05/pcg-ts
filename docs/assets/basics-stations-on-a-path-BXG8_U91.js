var e=`{\r
  "formatVersion": 1,\r
  "seed": 8317,\r
  "meta": {\r
    "title": "read a lap's own frame and width at thirty arbitrary stations, and place markers there",\r
    "description": "AN N-POINT CLOUD OF STATIONS AGAINST AN M-POINT PATH. Thirty markers, sixty-four path points, and no relationship between the two numbers: each marker carries one number — how far along the lap it belongs — and \`transferAlongPath\` reads the path there and writes the answer onto the marker. Nothing else in the library can state that. \`pathResample\` and \`place/along-curve\` step a WHOLE curve at even intervals, so the count is the curve's to decide and the positions are evenly spaced by construction. \`pathPointAt\` slides the path's OWN points, so its output carries the path's point count and topology and can only ever answer questions about the path itself. \`writeCurveFrame\` evaluates at a path's existing points and nowhere between them. The stations here are none of those things: they are thirty numbers drawn independently, they do not divide anything evenly, and they arrived on a cloud that has never met this path.\\n\\nTHE ARC COORDINATE IS THE CHORD ONE, and it is the same one every other path node uses: the running sum of the straight-line distances between consecutive path points, closing segment included. This 64-corner loop of radius 16 measures 100.4906, a little under the 100.5310 of the circle it approximates, and that shortfall is the honest number — a polyline is what the library stores, and a length taken off a curve fitted through the points would be a measurement of something that is not there. \`pathPointAt\`'s 'distance' mode, \`arcTile\`'s \`startAttr\` and this node's \`arcAttr\` all mean this same coordinate, which is what lets one graph mix them.\\n\\nTHE STATIONS RUN OFF BOTH ENDS OF THE LAP, ON PURPOSE. Each marker's station is drawn uniformly from [-24, 126) — wider than the lap in both directions, so about a sixth of them are negative and a sixth are past the end. Every one of them still lands on the road, because \`wrap\` is on and the path is CLOSED: the position is taken modulo the length and a negative is corrected, so -12 is 88.49 and 130 is 29.51. That is the same reading of a closed path's seam that \`pathRuns\`, \`runFit\` and \`arcTile\` take, and it is what makes an arc coordinate usable as a lap counter — a car three and a half laps in has travelled 351.7, and 351.7 is a place. Turn \`wrap\` off and the two tails would pile up on the start/finish line instead, which is what CLAMPING means and what an OPEN path does whatever \`wrap\` says, since it has no seam to cross.\\n\\nWHICH COLUMNS ARE SAMPLED IS SPELLED OUT HERE RATHER THAN LEFT TO THE DEFAULT. \`attributes\` names three, and each is a different reason for the node to exist. \`P\` is the placement: sampling it MOVES every marker onto the curve at its own station, which is how a cloud of numbers becomes a set of positions on a road, and it is the reason the eight standard bookkeeping columns are excluded from the default rule rather than forbidden — the default must not move a cloud, but naming P must always work. \`tangent\` is the direction, written on the path by \`writeCurveFrame\` and read here so \`orientAlongVector\` can turn each marker to face the way the road goes. \`roadWidth\` is the one nobody but the author knew about: it was computed on the path's sixty-four points and it is read at thirty places that are not any of them. Leaving \`attributes\` empty would have sampled \`tangent\`, \`curveNormal\`, \`curveBinormal\` and \`roadWidth\` — every numeric column that is not bookkeeping — and left the markers where they were, which is a different graph.\\n\\nINTERPOLATING A DIRECTION SHORTENS IT, which is why \`normalize\` names \`tangent\`. Two unit vectors blended halfway are shorter than one by a factor that depends on the angle between them, so the shortfall is worst exactly where the road turns hardest and it is invisible until something reads the length. Renormalising each axis independently does NOT re-orthogonalise them, so a frame that must stay orthonormal has to be rebuilt from two of its axes with a cross product; that is not what this param does and the node's description says so.\\n\\nEVERY SAMPLED COLUMN ARRIVES AS f32, whatever the path stored it as, because an interpolated value is a real number: a lane index read halfway between lane 1 and lane 2 is 1.5, and an integer column would round that to a value neither neighbour holds and destroy the one fact the query was asking for. A value that must stay discrete is not an interpolation and belongs on \`transferAttribute\`'s 'nearest' mapping — which is also the node to reach for when the question really is 'what is nearest in space'. The two are not interchangeable, and where they part company is a fold: two stations tens of units apart along a lap are centimetres apart in world space at a hairpin, and a nearest-point gather there reads the far side of the corner and reports it as a hit.\\n\\nThe marker sizes are the proof that the width made it across: \`scale\` IS the gathered \`roadWidth\`, which runs between 1.8 and 4.2 twice around the loop, so the markers breathe with the road at stations the road was never sampled at. The second output is the lap itself, to read them against.",\r
    "tags": ["basics", "path", "curve", "closed", "instancing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "loop",\r
      "type": "subgraph",\r
      "params": { "count": 64, "size": [16, 16, 16] },\r
      "ref": { "name": "shape/path-loop" }\r
    },\r
    {\r
      "id": "frame",\r
      "type": "writeCurveFrame",\r
      "params": {}\r
    },\r
    {\r
      "id": "width",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "roadWidth",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "add",\r
          "args": [\r
            3,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                1.2,\r
                { "fn": "sin", "args": [{ "fn": "mul", "args": [{ "fn": "index" }, 0.19634954] }] }\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "markers",\r
      "type": "pointLine",\r
      "params": { "mode": "endpoints", "count": 30, "start": [0, 0, 0], "end": [29, 0, 0], "includeEnd": true }\r
    },\r
    {\r
      "id": "station",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "station",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "add",\r
          "args": [-24, { "fn": "mul", "args": [{ "fn": "randomField", "key": "station" }, 150] }]\r
        }\r
      }\r
    },\r
    {\r
      "id": "gather",\r
      "type": "transferAlongPath",\r
      "params": {\r
        "arcAttr": "station",\r
        "attributes": ["P", "tangent", "roadWidth"],\r
        "normalize": ["tangent"],\r
        "wrap": true\r
      }\r
    },\r
    {\r
      "id": "orient",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": { "fn": "attribute", "name": "tangent" },\r
        "up": [0, 1, 0],\r
        "axis": "+z"\r
      }\r
    },\r
    {\r
      "id": "size",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            { "fn": "vec", "args": [1, 1, 1] },\r
            { "fn": "attribute", "name": "roadWidth" }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "lamp" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["loop", "out"], "to": ["frame", "in"] },\r
    { "from": ["frame", "out"], "to": ["width", "in"] },\r
    { "from": ["width", "out"], "to": ["gather", "path"] },\r
    { "from": ["markers", "out"], "to": ["station", "in"] },\r
    { "from": ["station", "out"], "to": ["gather", "at"] },\r
    { "from": ["gather", "out"], "to": ["orient", "in"] },\r
    { "from": ["orient", "out"], "to": ["size", "in"] },\r
    { "from": ["size", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "width", "pin": "out", "name": "road" },\r
    { "id": "spawn", "pin": "instances", "name": "markers" }\r
  ]\r
}\r
`;export{e as default};