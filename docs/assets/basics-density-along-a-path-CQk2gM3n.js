var e=`{\r
  "formatVersion": 1,\r
  "seed": 1059,\r
  "meta": {\r
    "title": "place an exact number of points along a path, bunched where a density says",\r
    "description": "Scattering in proportion to a density usually means rejection sampling: draw a candidate, keep it with probability density, and accept whatever count comes out. The count is then binomial — ask for ninety and get eighty-one this cook and ninety-six the next — which is fine for grass and useless for anything an author counts. \`pathScan\` buys the other trade: it writes the RUNNING TOTAL of a point attribute along each polyline in the path's own walk order, and a running total of a density is a cumulative distribution. Sample the inverse of that at ninety places and you get ninety points, every one of them placed in proportion to the density, with no draw to be unlucky in. This is the operation a field structurally cannot express at any length: a field resolves each element from that element alone, so 'how much density lies BEHIND me along this curve' has no formulation in the grammar — which is why it is a node.\\n\\nThe pieces, in the order they appear. \`density\` is any expression of \`curveU\`, here one hump per lap, and it is FLOORED at 0.02 rather than allowed to reach zero: across a dead stretch the distribution is flat, the inverse is ambiguous, and the nearest-point lookup below picks arbitrarily within it. \`mode: \\"exclusive\\"\` starts the first sample at zero — that is the mode that makes the first bucket reachable, since an inclusive scan gives the first sample its own whole value and nothing can land below it. \`totalAttr\` reports each path's whole total to the PRIMITIVE domain, \`promoteAttribute\` brings it back to the points, and dividing gives a cdf in [0, 1). Both ends matter and neither is more correct: exclusive is exact at the start, inclusive at the end.\\n\\nThe lookup is the part with no primitive behind it. Finding the sample whose cdf bucket contains a given u is a scalar-keyed search, and the library has no node for one, so the cdf is laid out AS GEOMETRY: each sample is re-embedded at (cdf, 0, 0) — \`onCurve\` saves its real position first — and \`sampleNearestPoint\` answers the question with a spatial query. Read the approximation honestly: nearest-in-cdf is not the containing bucket, it is the nearer of the two bucket edges, so a point can sit up to half a bucket off — a tenth of a percent of the lap at the 480 samples used here, and invisible. THE SAMPLE COUNT IS NOT FREE, though, and the rule is worth carrying: a sample's cdf bucket is as wide as its share of the total, so the widest one must stay NARROWER than the anchor spacing 1 / count, or two anchors fall in one bucket and land two points on the same spot. This graph at 240 samples did exactly that — peak bucket 0.0128 against a spacing of 0.0111, four coincident pairs out of ninety — and a graph teaching an exact count has no business emitting a doubled point. Halving the bucket fixed it. Denser density humps need more samples, and the check is arithmetic, not taste. The anchors themselves come from \`pointLine\` between [0,0,0] and [1,0,0] with \`includeEnd\` false, which is a stratified sample of the half-open range and needs no random number at all: point i sits at exactly i / count. A golden-ratio or uniform-random u substitutes here unchanged — the machinery downstream does not care where u came from.",\r
    "tags": ["basics", "path", "density", "sampling", "scan"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ellipse",\r
      "type": "subgraph",\r
      "params": { "count": 40, "size": [30, 30, 10] },\r
      "ref": { "name": "shape/ring" }\r
    },\r
    {\r
      "id": "path",\r
      "type": "pointsToPath",\r
      "params": { "closed": true }\r
    },\r
    {\r
      "id": "curve",\r
      "type": "pathResample",\r
      "params": { "mode": "count", "count": 480, "lengthAttr": "lapLength" }\r
    },\r
    {\r
      "id": "density",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "density",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "add",\r
          "args": [\r
            0.02,\r
            {\r
              "fn": "pow",\r
              "args": [\r
                {\r
                  "fn": "add",\r
                  "args": [\r
                    0.5,\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        0.5,\r
                        {\r
                          "fn": "cos",\r
                          "args": [\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                { "fn": "attribute", "name": "curveU" },\r
                                6.283185307179586\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                3\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "scan",\r
      "type": "pathScan",\r
      "params": {\r
        "name": "density",\r
        "outName": "cdfRaw",\r
        "mode": "exclusive",\r
        "totalAttr": "cdfTotal"\r
      }\r
    },\r
    {\r
      "id": "total",\r
      "type": "promoteAttribute",\r
      "params": { "name": "cdfTotal", "from": "primitive", "to": "point", "mode": "average" }\r
    },\r
    {\r
      "id": "keepP",\r
      "type": "setAttribute",\r
      "params": { "name": "onCurve", "tupleSize": 3, "value": { "fn": "position" } }\r
    },\r
    {\r
      "id": "embed",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "P",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "div",\r
              "args": [\r
                { "fn": "attribute", "name": "cdfRaw" },\r
                { "fn": "attribute", "name": "cdfTotal" }\r
              ]\r
            },\r
            0,\r
            0\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "anchors",\r
      "type": "pointLine",\r
      "params": {\r
        "mode": "endpoints",\r
        "count": 90,\r
        "start": [0, 0, 0],\r
        "end": [1, 0, 0],\r
        "includeEnd": false\r
      }\r
    },\r
    {\r
      "id": "pick",\r
      "type": "sampleNearestPoint",\r
      "params": { "attribute": "onCurve", "outAttribute": "onCurve", "distanceAttr": "cdfDist" }\r
    },\r
    {\r
      "id": "land",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "P",\r
        "tupleSize": 3,\r
        "value": { "fn": "attribute", "name": "onCurve", "tupleSize": 3 }\r
      }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["ellipse", "out"], "to": ["path", "in"] },\r
    { "from": ["path", "out"], "to": ["curve", "in"] },\r
    { "from": ["curve", "out"], "to": ["density", "in"] },\r
    { "from": ["density", "out"], "to": ["scan", "in"] },\r
    { "from": ["scan", "out"], "to": ["total", "in"] },\r
    { "from": ["total", "out"], "to": ["keepP", "in"] },\r
    { "from": ["keepP", "out"], "to": ["embed", "in"] },\r
    { "from": ["anchors", "out"], "to": ["pick", "in"] },\r
    { "from": ["embed", "out"], "to": ["pick", "source"] },\r
    { "from": ["pick", "out"], "to": ["land", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "land", "pin": "out", "name": "points" },\r
    { "id": "keepP", "pin": "out", "name": "path" }\r
  ]\r
}\r
`;export{e as default};