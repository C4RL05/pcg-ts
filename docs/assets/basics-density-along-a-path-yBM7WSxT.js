var e=`{
  "formatVersion": 1,
  "seed": 1059,
  "meta": {
    "title": "place an exact number of points along a path, bunched where a density says",
    "description": "Scattering in proportion to a density usually means rejection sampling: draw a candidate, keep it with probability density, and accept whatever count comes out. The count is then binomial — ask for ninety and get eighty-one this cook and ninety-six the next — which is fine for grass and useless for anything an author counts. \`pathScan\` buys the other trade: it writes the RUNNING TOTAL of a point attribute along each polyline in the path's own walk order, and a running total of a density is a cumulative distribution. Sample the inverse of that at ninety places and you get ninety points, every one of them placed in proportion to the density, with no draw to be unlucky in. This is the operation a field structurally cannot express at any length: a field resolves each element from that element alone, so 'how much density lies BEHIND me along this curve' has no formulation in the grammar — which is why it is a node.\\n\\nThe pieces, in the order they appear. \`density\` is any expression of \`curveU\`, here one hump per lap, and it is FLOORED at 0.02 rather than allowed to reach zero: across a dead stretch the distribution is flat, the inverse is ambiguous, and the nearest-point lookup below picks arbitrarily within it. \`mode: \\"exclusive\\"\` starts the first sample at zero — that is the mode that makes the first bucket reachable, since an inclusive scan gives the first sample its own whole value and nothing can land below it. \`totalAttr\` reports each path's whole total to the PRIMITIVE domain, \`promoteAttribute\` brings it back to the points, and dividing gives a cdf in [0, 1). Both ends matter and neither is more correct: exclusive is exact at the start, inclusive at the end.\\n\\nThe lookup is the part with no primitive behind it. Finding the sample whose cdf bucket contains a given u is a scalar-keyed search, and the library has no node for one, so the cdf is laid out AS GEOMETRY: each sample is re-embedded at (cdf, 0, 0) — \`onCurve\` saves its real position first — and \`sampleNearestPoint\` answers the question with a spatial query. Read the approximation honestly: nearest-in-cdf is not the containing bucket, it is the nearer of the two bucket edges, so a point can sit up to half a bucket off — a tenth of a percent of the lap at the 480 samples used here, and invisible. THE SAMPLE COUNT IS NOT FREE, though, and the rule is worth carrying: a sample's cdf bucket is as wide as its share of the total, so the widest one must stay NARROWER than the anchor spacing 1 / count, or two anchors fall in one bucket and land two points on the same spot. This graph at 240 samples did exactly that — peak bucket 0.0128 against a spacing of 0.0111, four coincident pairs out of ninety — and a graph teaching an exact count has no business emitting a doubled point. Halving the bucket fixed it. Denser density humps need more samples, and the check is arithmetic, not taste. The anchors themselves come from \`pointLine\` between [0,0,0] and [1,0,0] with \`includeEnd\` false, which is a stratified sample of the half-open range and needs no random number at all: point i sits at exactly i / count. A golden-ratio or uniform-random u substitutes here unchanged — the machinery downstream does not care where u came from.",
    "tags": ["basics", "path", "density", "sampling", "scan"]
  },
  "nodes": [
    {
      "id": "ellipse",
      "type": "subgraph",
      "params": { "count": 40, "size": [30, 30, 10] },
      "ref": { "name": "shape/ring" }
    },
    {
      "id": "path",
      "type": "pointsToPath",
      "params": { "closed": true }
    },
    {
      "id": "curve",
      "type": "pathResample",
      "params": { "mode": "count", "count": 480, "lengthAttr": "lapLength" }
    },
    {
      "id": "density",
      "type": "setAttribute",
      "params": {
        "name": "density",
        "tupleSize": 1,
        "value": {
          "fn": "add",
          "args": [
            0.02,
            {
              "fn": "pow",
              "args": [
                {
                  "fn": "add",
                  "args": [
                    0.5,
                    {
                      "fn": "mul",
                      "args": [
                        0.5,
                        {
                          "fn": "cos",
                          "args": [
                            {
                              "fn": "mul",
                              "args": [
                                { "fn": "attribute", "name": "curveU" },
                                6.283185307179586
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                3
              ]
            }
          ]
        }
      }
    },
    {
      "id": "scan",
      "type": "pathScan",
      "params": {
        "name": "density",
        "outName": "cdfRaw",
        "mode": "exclusive",
        "totalAttr": "cdfTotal"
      }
    },
    {
      "id": "total",
      "type": "promoteAttribute",
      "params": { "name": "cdfTotal", "from": "primitive", "to": "point", "mode": "average" }
    },
    {
      "id": "keepP",
      "type": "setAttribute",
      "params": { "name": "onCurve", "tupleSize": 3, "value": { "fn": "position" } }
    },
    {
      "id": "embed",
      "type": "setAttribute",
      "params": {
        "name": "P",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            {
              "fn": "div",
              "args": [
                { "fn": "attribute", "name": "cdfRaw" },
                { "fn": "attribute", "name": "cdfTotal" }
              ]
            },
            0,
            0
          ]
        }
      }
    },
    {
      "id": "anchors",
      "type": "pointLine",
      "params": {
        "mode": "endpoints",
        "count": 90,
        "start": [0, 0, 0],
        "end": [1, 0, 0],
        "includeEnd": false
      }
    },
    {
      "id": "pick",
      "type": "sampleNearestPoint",
      "params": { "attribute": "onCurve", "outAttribute": "onCurve", "distanceAttr": "cdfDist" }
    },
    {
      "id": "land",
      "type": "setAttribute",
      "params": {
        "name": "P",
        "tupleSize": 3,
        "value": { "fn": "attribute", "name": "onCurve", "tupleSize": 3 }
      }
    }
  ],
  "connections": [
    { "from": ["ellipse", "out"], "to": ["path", "in"] },
    { "from": ["path", "out"], "to": ["curve", "in"] },
    { "from": ["curve", "out"], "to": ["density", "in"] },
    { "from": ["density", "out"], "to": ["scan", "in"] },
    { "from": ["scan", "out"], "to": ["total", "in"] },
    { "from": ["total", "out"], "to": ["keepP", "in"] },
    { "from": ["keepP", "out"], "to": ["embed", "in"] },
    { "from": ["anchors", "out"], "to": ["pick", "in"] },
    { "from": ["embed", "out"], "to": ["pick", "source"] },
    { "from": ["pick", "out"], "to": ["land", "in"] }
  ],
  "outputs": [
    { "id": "land", "pin": "out", "name": "points" },
    { "id": "keepP", "pin": "out", "name": "path" }
  ]
}
`;export{e as default};