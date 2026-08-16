var e=`{\r
  "formatVersion": 1,\r
  "seed": 3,\r
  "meta": {\r
    "title": "a suspended rig, built from curves",\r
    "description": "A box truss follows a spline pushed around by two noises: four chords with zigzag bracing and square frames every few bays. Components are scattered over it in noise clusters and aimed radially, chains hang it from the ceiling, cables wrap along it, and two more kinds hang off it — a fringe gathered into bundles, and swags strung between anchors. The cables are a \`forEach\`: one body cooked once per cable, each seeded on its own carrier, where this used to need one hand-built branch per cable and so could not be a saved graph at all. The wander is a plain \`transformPoints\`: the three numbers shaping it — how far it drifts up, how far sideways, and how fast — are \`param\` spec nodes carrying their own values inside its \`translate\` expression, and the sandbox reads each as a knob. It used to be a one-node subgraph, because a param could only be DECLARED on a wrapper, and the wrapper existed for nothing else. \`wanderScale\` is named twice in that one expression and is still one knob writing both — the case that made a wrapper look unavoidable. Everything that was drawn as a tube is a real surface now: \`sweepProfile\` skins the chords, the braces, the frames, the cables, the fringe and the swags, every one of which used to end at \`pathSegments\` with a unit cylinder landing on each segment — half the drawn triangles, because rings are shared between segments and no interior caps grow, and nine \`extend\` settings gone with them, because a continuous skin leaves no wedge at a bend to fill. The chains do NOT sweep, and that is the line between the two nodes: \`pathSegments\` still has a job of its own, one oriented asset per segment, and a chain of separate links is exactly that job — what it lost is the borrowed one, faking a tube. Four chords reach ONE sweep rather than four, because a sweep reads a geometry and a geometry holds as many polylines as you like: each strut arrives from \`pathResample\` already a polyline, \`transformPoints\` moves it without touching that topology, and \`mergePrimitives\` unions the four KEEPING it, so the sweep gets four paths in one geometry and the chord radius stays a single knob rather than one knob mirrored into four. Seven values this graph repeats are declared once at the top, under \`params\`. Six are numbers read by name from the expressions that need them: \`trussHalfWidth\` was TWENTY literals in four different float spellings of 0.425 — the chords at ± it, the braces and the component mounts at it × √2 — and \`cableRadius\` was three nodes that only the panel's \`also\` knew were one gauge of rope. A node-scoped param cannot say either of those, because the thing being said is that several nodes share one value. Four more say it about smaller things. \`braceRadius\` gangs the diagonal braces to the station frames, and it retired the last \`also\` row in the whole corpus: no fact about this graph's structure lives in a presentation file any more. \`stretchMin\` and \`stretchMax\` are the two ends of ONE draw that the component sizes write once per axis — \`lerp(0.55, 1.6, randomField(\\"stretch\\"))\`, four times over, for the rod, the bar and the panel's two faces — where how far a component may stretch is a single decision and eight literals were spelling it. \`bundles\` is the fringe's 7, read twice inside one expression: \`floor(u × 7)\` bins each strand and the \`/ 7\` puts the bin back in [0, 1), so the two have to agree, and until the number had a name nothing said so. The seventh travels the other way. \`tubeSides\` is an \`i32\`, and no expression can ever carry one — a field resolves per element and only f32, vec3 and vec4 read one — so it declares \`targets\` and is WRITTEN into the \`sides\` slot of all six skins — five \`sweepProfile\` nodes and, through its wrapper, the sixth inside the cable body — rather than substituted into a field, which is how one name reaches the half of the format that counts, enums, booleans and attribute names live in. It is one decision because it is a BUDGET and not a dimension: cost is linear in it, six skins pay it at once, and nothing about a 0.03-radius brace wants a different roundness from the 0.055-radius chord standing next to it. The gauge params say the opposite about the very same nodes — \`cableRadius\` and \`braceRadius\` gang radii precisely because a radius legitimately differs from member to member — which is why \`sides\` is the only one of the six non-field literals every sweep repeats that earns a name. The other five stay written out, and that is a measurement rather than an oversight: \`profile\` means \\"a rope is round\\" at three sites and \\"the stock is round tube\\" at the other three, \`caps\` turns on whether a tube's ends are visible at all (the station frames are closed rings and have no ends, the braces bury theirs inside the chords), \`frame\` is invisible on a circular section — as are the field-capable \`up\` and \`roll\` written out beside it — and \`joint\` with its \`miterLimit\` is one pair rather than two decisions, neither of which moves: \`miter\` is simply the right answer at the two places this rig actually bends and indistinguishable from \`perpendicular\` everywhere else, and the limit is never reached, because the sharpest bend anywhere a sweep sees is the braces' zigzag at 100°, a stretch of 1.56 against a limit of 4, with the frame ring's square corner next at 1.41 and every resampled curve under 1.02. A shared name asserts that several slots must move together, and asserting that falsely is worse than the repetition. The sixth reading is inside the cable \`forEach\` body and gets there through a \`sides\` param on the wrapper, sitting next to \`halfWidth\` and working by the opposite mechanism: \`halfWidth\` declares NO targets and is read by the body's own expression, \`sides\` names one and is written into it. A body is bound by its wrapper either way and by nothing else, so ganging five of six would have left the cables at 8 while everything else moved. The three \`writeCurveFrame\` nodes repeat their three attribute names and KEEP them, now that a \`string\` param could reach them: \`curveNormal\` is named fourteen times here and only three of those are the writes — the other eleven are \`attribute(\\"curveNormal\\")\` inside expressions, where no param can follow — and \`sweepProfile\`'s own \`curveFrame\` mode reads that attribute by that name in the library itself. The name is a shared vocabulary rather than this graph's to rename, so a knob over the three writers would only break the eleven readers. It used to tag every strut with a \`strutId\`, merge the POINTS, and rebuild the same four paths with \`pointsToPath\` — ten nodes spent throwing topology away and putting it back, because the topology-preserving union did not exist yet when this graph was written. The frames still regroup, and that contrast is the useful one: their rings connect the four chords ACROSS each station, topology that never existed anywhere upstream, so \`pointsToPath\` over \`stationId\` BUILDS something rather than restoring it — and the filter feeding it drops three points in four, which no union could have preserved. The chains and the fringe do not regroup at all any more, and that is the other half of the contrast: each strand is made a path BEFORE it is copied, and \`copyToPoints\` carries it across with \`topology: \\"keep\\"\` — the source's one polyline re-emitted per anchor, shifted onto that anchor's block of points. What that retires is not a node but a round trip. The copy no longer has to label its output with \`targetIndexAttr\` so that a rebuild can group on the label, and the fringe's swept surface stops carrying a dead \`anchorId\` on all 17,100 of its points; the path is built once over the strand itself — 35 points for a chain, 17 for a fringe strand — instead of over the 245 and the 1700 the copies make of them. The label was itself the second version of this problem: before \`targetIndexAttr\` the id was recovered arithmetically — \`floor(index / 35)\` for the chains and \`floor(index / 17)\` for the fringe — where the 35 and the 17 were the strand's point count written out a second time, in another node, with nothing holding the two together, so editing the strand welded every chain into one path and said nothing. A strand that is already a path cannot fall out of step with itself, which is the version that has no number in it at all. The swags are gated BEFORE the sweep now, which is where a gate has to sit once the thing downstream of it is a surface: \`connectPoints\` writes \`edgeLength\` on the primitive domain and the pick lands there too, so \`filterPrimitivesByAttribute\` cuts 456 chords to 63 while they are still polylines — gating the segment cloud afterwards, which is what this graph used to do, meant building 7.24 times the geometry that survives. The components are proportioned by KIND rather than by one draw wearing four hats: one \`byAttribute\` reads the string \`part\` and hands back that kind's whole vec3, so a rod lengthens along the radius it points down, a bar along the chord it lies on, a panel widens on both of its faces while staying slab-thin, and a clamp is a squat collar rather than a cube. It was three nested \`lerp\`s over three \`attributeIs\` calls, written out once per AXIS — and \`clamp\` was in none of them, so it fell through all three to the uniform base scale and stayed there, because a fall-through nobody writes is a fall-through nobody can find. Its \`default\` is the same sentence made explicit: any part kind this expression does not name keeps the base scale, unstretched, and now says so. Eight declared outputs, one per part, plus the bare spine, so a viewer can tell them apart. The seed box re-rolls what is keyed on a node seed — where the components land, which chords get hung, how far each cable drops, and the four scalars that make each wrap its own — and the noises with it: all eight fbm fields take their seed from the node, \`{ \\"from\\": \\"node\\", \\"variant\\": … }\` rather than a literal, so the spine takes a different wander and the clusters a different shape instead of the same frozen field being walked over by points that moved. The six outside the cable body each carry their \`variant\` as an inline \`param\` of their own, so ONE noise can be re-rolled while the rest hold still — a node has a single seed, and the variant is what picks which draw off it. That is also what keeps the pairs apart: the spine's two wanders sit on one node and the fringe's two curls on another, so within each pair variant 0 and variant 1 are what make them independent draws, where a literal seed used to do it. The last two are the cable wobble, inside the \`forEach\` body, and they were held back as the deliberate exception — the body's seed varies per item, so its wobble was said to re-roll already. That was true of the sample WINDOW and false of the FIELD. Freeze the four per-carrier picks and cook: on the old literal seed the sixteen cables come back as ONE geometry, on the node seed as sixteen. A body node's seed is hashed with the item's own key, so \`{ \\"from\\": \\"node\\" }\` there means per-cable, and what it replaced was a fourth pick — \`wofs\`, transferred onto the wrap and multiplied by 1000 — whose whole job was to walk one frozen field far enough sideways that no two cables sampled the same place. That pick and its transfer are gone with it: the body is eight nodes where it was ten. Variants 0 and 1 keep the wobble's two components apart, the one riding the curve normal and the one riding the binormal, which a single literal seed had collapsed into the same number twice.",\r
    "tags": [\r
      "examples",\r
      "curves",\r
      "foreach",\r
      "surface",\r
      "instancing",\r
      "rig"\r
    ]\r
  },\r
  "params": [\r
    {\r
      "name": "cableRadius",\r
      "value": 0.035,\r
      "min": 0.005,\r
      "max": 0.2,\r
      "description": "Radius of every rope on the rig — the cable wraps, the fringe strands and the swags — in world units. One value because they are one gauge of rope, which the graph had no way to say: it lived in three nodes, and only the panel's \`also\` knew they were one thing."\r
    },\r
    {\r
      "name": "trussHalfWidth",\r
      "value": 0.425,\r
      "min": 0.15,\r
      "max": 1.2,\r
      "description": "Half the width of the box truss, in world units: the distance from the spine out to each chord. The four chords sit at ± this along the curve normal and binormal, and the diagonal braces and component mounts at this × √2 — twenty readings of one number, previously written in four different float spellings of it, so this is the knob that sizes the truss. Two of the twenty live inside the cable \`forEach\` body and reach it through the wrapper's own \`halfWidth\` param, because a body is bound by its wrapper and by nothing else — they were missed when the other eighteen were collapsed, and the cables sat inside the truss at any value but the default until they were plumbed through."\r
    },\r
    {\r
      "name": "braceRadius",\r
      "value": 0.03,\r
      "min": 0.005,\r
      "max": 0.12,\r
      "description": "Radius of the diagonal braces and of the station frames, in world units — the truss's thinner tube, set against the chords' own. One value because they are one gauge of tube, which the graph had no way to say: the pairing lived in the corpus's only panel \`also\` row, in a presentation file, which is the wrong place for a fact about the graph."\r
    },\r
    {\r
      "name": "stretchMin",\r
      "value": 0.55,\r
      "min": 0.1,\r
      "max": 1,\r
      "description": "The short end of the per-component stretch, as a multiple of the base size. Each kind stretches along the axis its own shape wants — a rod down the radius it points, a bar along the chord it lies on, a panel across both of its faces — but all four of those are the same draw, \`lerp($stretchMin, $stretchMax, randomField(\\"stretch\\"))\`, written once per axis. Lift this toward the max and the components go uniform."\r
    },\r
    {\r
      "name": "stretchMax",\r
      "value": 1.6,\r
      "min": 1,\r
      "max": 4,\r
      "description": "The long end of that same draw, read at the same four sites. Two names rather than eight literals is the point: how far a component may stretch is ONE decision, and the rod, the bar and the panel's two axes have to agree on it or the parts stop reading as one kit."\r
    },\r
    {\r
      "name": "bundles",\r
      "value": 7,\r
      "min": 1,\r
      "max": 20,\r
      "description": "How many bundles the fringe is gathered into. \`danglerBundling\` bins each strand's \`curveU\` with \`floor(u × $bundles)\` and then divides by the same number to put the bin back in [0, 1) — the two readings must agree, and until the number had a name nothing said so. Raise it for more and thinner tufts; at 1 the whole fringe gathers to one point. A whole number: \`floor\` makes a fraction mean a ragged last bundle."\r
    },\r
    {\r
      "name": "tubeSides",\r
      "value": 8,\r
      "targets": [\r
        {\r
          "node": "trussChordSkin",\r
          "param": "sides"\r
        },\r
        {\r
          "node": "trussBraceSkin",\r
          "param": "sides"\r
        },\r
        {\r
          "node": "trussFrameSkin",\r
          "param": "sides"\r
        },\r
        {\r
          "node": "wrapWraps",\r
          "param": "sides"\r
        },\r
        {\r
          "node": "danglerDanglerSkin",\r
          "param": "sides"\r
        },\r
        {\r
          "node": "drapeDrapeSkin",\r
          "param": "sides"\r
        }\r
      ],\r
      "min": 3,\r
      "max": 32,\r
      "description": "Points around the section of EVERY tube this rig sweeps — the chords, the braces, the station frames, the cable wraps, the fringe and the swags. An \`i32\`, so no expression could ever have carried it: this is the first param here that travels by being WRITTEN into six node slots rather than substituted into a field. It is one decision because it is a TESSELLATION BUDGET and not a dimension: cost is linear in it and six skins pay it at once, and nothing about a 0.03-radius brace wants a different roundness from a 0.055-radius chord seen in the same object at the same distance. The gauge params say the opposite about the very same nodes — \`cableRadius\` and \`braceRadius\` gang radii precisely because a radius is a design dimension that legitimately differs from member to member — which is what makes \`sides\` the one of the six repeated non-field literals on \`sweepProfile\` that earns a name. 8 is the radial segment count of the \`tube\` asset every one of these skins replaced — a unit cylinder landing on each segment — so a swept tube still reads like the instanced one it grew out of, and raising it is a deliberate step away from that. The range is the node's own 3..256 narrowed to 3..32, which is the one direction a declaration may move a bound: past 32 sides on a 0.03-radius tube there is nothing left to see, and a declaration that could WIDEN one would be claiming a range its targets never agreed to. The sixth reading is inside the cable \`forEach\` body and reaches it through the wrapper's own \`sides\` param, because a body is bound by its wrapper and by nothing else — ganging five of six would leave the cables at 8 while the rest moved, which is the desync \`trussHalfWidth\` had to be fixed for."\r
    }\r
  ],\r
  "nodes": [\r
    {\r
      "id": "spineLine",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 97,\r
        "start": [\r
          -17,\r
          7,\r
          0\r
        ],\r
        "end": [\r
          17,\r
          7,\r
          0\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "spineWander",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "verticalAmplitude",\r
                  "value": 1.2,\r
                  "min": 0,\r
                  "max": 8,\r
                  "description": "How far the spine wanders up and down, in world units, multiplied into a perlin fBm that is already centred on zero — so 0 gives a straight spine."\r
                },\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": {\r
                      "from": "node",\r
                      "variant": {\r
                        "fn": "param",\r
                        "name": "variantUp",\r
                        "value": 0\r
                      }\r
                    },\r
                    "frequency": 0.035,\r
                    "position": {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "position"\r
                        },\r
                        {\r
                          "fn": "param",\r
                          "name": "wanderScale",\r
                          "value": 1,\r
                          "min": 0.1,\r
                          "max": 8,\r
                          "description": "Scales the position both noises are sampled at, so larger means a tighter, faster wander and 1 is the wander the graph was authored with. It is a MULTIPLIER rather than a frequency because that is what keeps the default exact: the base frequency stays in the noise, where it multiplies in f64, and x1.0 through the position column is the identity. One name, read twice in one expression — so this single knob reaches both noises."\r
                        }\r
                      ]\r
                    },\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "octaves": 3,\r
                    "lacunarity": 2,\r
                    "gain": 0.5\r
                  }\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "horizontalAmplitude",\r
                  "value": 2.4,\r
                  "min": 0,\r
                  "max": 12,\r
                  "description": "How far the spine wanders sideways over the same run, on its own noise seed, so the two axes drift independently instead of tracing one curve in a plane."\r
                },\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": {\r
                      "from": "node",\r
                      "variant": {\r
                        "fn": "param",\r
                        "name": "variantAcross",\r
                        "value": 1\r
                      }\r
                    },\r
                    "frequency": 0.035,\r
                    "position": {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "position"\r
                        },\r
                        {\r
                          "fn": "param",\r
                          "name": "wanderScale",\r
                          "value": 1\r
                        }\r
                      ]\r
                    },\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "octaves": 3,\r
                    "lacunarity": 2,\r
                    "gain": 0.5\r
                  }\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "spineSpinePath",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": false,\r
        "groupAttr": "",\r
        "orderAttr": ""\r
      }\r
    },\r
    {\r
      "id": "spineSpine",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 130,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "trussCells",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 46,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "trussFrame",\r
      "type": "writeCurveFrame",\r
      "params": {\r
        "tangentName": "tangent",\r
        "normalName": "curveNormal",\r
        "binormalName": "curveBinormal"\r
      }\r
    },\r
    {\r
      "id": "trussStation",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "stationId",\r
        "domain": "point",\r
        "type": "i32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "index"\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "trussMove0",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "trussHalfWidth"\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "trussHalfWidth"\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove2",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "param",\r
                      "name": "trussHalfWidth"\r
                    },\r
                    -1\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "trussHalfWidth"\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove4",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "param",\r
                      "name": "trussHalfWidth"\r
                    },\r
                    -1\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "param",\r
                      "name": "trussHalfWidth"\r
                    },\r
                    -1\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove6",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "trussHalfWidth"\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "param",\r
                      "name": "trussHalfWidth"\r
                    },\r
                    -1\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussCorners",\r
      "type": "mergePrimitives",\r
      "params": {}\r
    },\r
    {\r
      "id": "trussChordSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": 0.055,\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    },\r
    {\r
      "id": "trussMove1",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865476\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865476\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove3",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865476\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865476\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove5",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865477\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865477\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove7",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865474\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865477\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865477\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865474\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussBraces",\r
      "type": "mergePrimitives",\r
      "params": {}\r
    },\r
    {\r
      "id": "trussBraceSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": {\r
          "fn": "param",\r
          "name": "braceRadius"\r
        },\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    },\r
    {\r
      "id": "trussPhase",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "framePhase",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "sub",\r
          "args": [\r
            {\r
              "fn": "attribute",\r
              "name": "stationId",\r
              "tupleSize": 1\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 4\r
                },\r
                {\r
                  "fn": "floor",\r
                  "args": [\r
                    {\r
                      "fn": "div",\r
                      "args": [\r
                        {\r
                          "fn": "attribute",\r
                          "name": "stationId",\r
                          "tupleSize": 1\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 4\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "trussKeep",\r
      "type": "filterByAttribute",\r
      "params": {\r
        "attribute": "framePhase",\r
        "comparison": "lt",\r
        "value": 0.5,\r
        "stringValue": ""\r
      }\r
    },\r
    {\r
      "id": "trussRing",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": true,\r
        "groupAttr": "stationId",\r
        "orderAttr": ""\r
      }\r
    },\r
    {\r
      "id": "trussFrameSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": {\r
          "fn": "param",\r
          "name": "braceRadius"\r
        },\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    },\r
    {\r
      "id": "partDense",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 900,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "partFrame",\r
      "type": "writeCurveFrame",\r
      "params": {\r
        "tangentName": "tangent",\r
        "normalName": "curveNormal",\r
        "binormalName": "curveBinormal"\r
      }\r
    },\r
    {\r
      "id": "partDensity",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "density",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "fbm",\r
          "base": "perlinNoise",\r
          "opts": {\r
            "seed": {\r
              "from": "node",\r
              "variant": {\r
                "fn": "param",\r
                "name": "clusterVariant",\r
                "value": 0\r
              }\r
            },\r
            "frequency": 14,\r
            "offset": [\r
              0,\r
              0,\r
              0\r
            ],\r
            "position": {\r
              "fn": "vec",\r
              "args": [\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveU",\r
                  "tupleSize": 1\r
                },\r
                {\r
                  "fn": "constant",\r
                  "value": 0\r
                },\r
                {\r
                  "fn": "constant",\r
                  "value": 0\r
                }\r
              ]\r
            },\r
            "octaves": 2,\r
            "lacunarity": 2,\r
            "gain": 0.5,\r
            "normalized": true\r
          }\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partCluster",\r
      "type": "filterByDensity",\r
      "params": {\r
        "mode": "threshold",\r
        "threshold": 0.46,\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partScatter",\r
      "type": "jitterPoints",\r
      "params": {\r
        "amount": [\r
          0.01888888888888889,\r
          0.01888888888888889,\r
          0.01888888888888889\r
        ],\r
        "seed": 3098584255\r
      }\r
    },\r
    {\r
      "id": "partPart",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "part",\r
        "domain": "point",\r
        "type": "string",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "randomField",\r
              "key": "part"\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 9\r
            }\r
          ]\r
        },\r
        "values": [\r
          "rod",\r
          "rod",\r
          "rod",\r
          "rod",\r
          "bar",\r
          "bar",\r
          "panel",\r
          "clamp",\r
          "clamp"\r
        ],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partAngleAttr",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "radialAngle",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "randomField",\r
              "key": "radial"\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 6.283185307179586\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partMount",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "cos",\r
                      "args": [\r
                        {\r
                          "fn": "add",\r
                          "args": [\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 1.5707963267948966\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "add",\r
                                      "args": [\r
                                        {\r
                                          "fn": "div",\r
                                          "args": [\r
                                            {\r
                                              "fn": "sub",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "radialAngle",\r
                                                  "tupleSize": 1\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0.7853981633974483\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 1.5707963267948966\r
                                            }\r
                                          ]\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 0.5\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            {\r
                              "fn": "constant",\r
                              "value": 0.7853981633974483\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "sin",\r
                      "args": [\r
                        {\r
                          "fn": "add",\r
                          "args": [\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 1.5707963267948966\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "add",\r
                                      "args": [\r
                                        {\r
                                          "fn": "div",\r
                                          "args": [\r
                                            {\r
                                              "fn": "sub",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "radialAngle",\r
                                                  "tupleSize": 1\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0.7853981633974483\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 1.5707963267948966\r
                                            }\r
                                          ]\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 0.5\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            {\r
                              "fn": "constant",\r
                              "value": 0.7853981633974483\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "partOrient",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": {\r
          "fn": "attribute",\r
          "name": "tangent",\r
          "tupleSize": 3\r
        },\r
        "up": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "cos",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "radialAngle",\r
                      "tupleSize": 1\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "sin",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "radialAngle",\r
                      "tupleSize": 1\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "axis": "+z"\r
      }\r
    },\r
    {\r
      "id": "partSize",\r
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
              "fn": "mul",\r
              "args": [\r
                { "fn": "param", "name": "partScale", "value": 1 },\r
                { "fn": "lerp", "args": [0.55, 1.45, { "fn": "randomField", "key": "size" }] }\r
              ]\r
            },\r
            {\r
              "fn": "byAttribute",\r
              "name": "part",\r
              "cases": {\r
                "rod": { "fn": "vec", "args": [1, { "fn": "lerp", "args": [{ "fn": "param", "name": "stretchMin" }, { "fn": "param", "name": "stretchMax" }, { "fn": "randomField", "key": "stretch" }] }, 1] },\r
                "bar": { "fn": "vec", "args": [1, 1, { "fn": "lerp", "args": [{ "fn": "param", "name": "stretchMin" }, { "fn": "param", "name": "stretchMax" }, { "fn": "randomField", "key": "stretch" }] }] },\r
                "panel": { "fn": "vec", "args": [{ "fn": "lerp", "args": [{ "fn": "param", "name": "stretchMin" }, { "fn": "param", "name": "stretchMax" }, { "fn": "randomField", "key": "stretch" }] }, 0.7, { "fn": "lerp", "args": [{ "fn": "param", "name": "stretchMin" }, { "fn": "param", "name": "stretchMax" }, { "fn": "randomField", "key": "stretch" }] }] },\r
                "clamp": [1.25, 0.5, 1.25]\r
              },\r
              "default": 1\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partPartSpawn",\r
      "type": "spawnInstances",\r
      "params": {\r
        "assetId": "rod",\r
        "assetAttr": "part",\r
        "colorAttr": ""\r
      }\r
    },\r
    {\r
      "id": "wrapCells",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 150,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "wrapFrame",\r
      "type": "writeCurveFrame",\r
      "params": {\r
        "tangentName": "tangent",\r
        "normalName": "curveNormal",\r
        "binormalName": "curveBinormal"\r
      }\r
    },\r
    {\r
      "id": "wrapCarrierLine",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 16,\r
        "start": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "end": [\r
          15,\r
          0,\r
          0\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "wrapCarrierId",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "wrapId",\r
        "domain": "point",\r
        "type": "i32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "index"\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "wrapCarriers",\r
      "type": "partitionByAttribute",\r
      "params": {\r
        "name": "wrapId"\r
      }\r
    },\r
    {\r
      "id": "wrapWraps",\r
      "type": "forEach",\r
      "params": {\r
        "cableRadius": {\r
          "fn": "param",\r
          "name": "cableRadius"\r
        },\r
        "halfWidth": {\r
          "fn": "param",\r
          "name": "trussHalfWidth"\r
        },\r
        "sides": 8\r
      },\r
      "subgraph": {\r
        "graph": {\r
          "formatVersion": 1,\r
          "seed": 0,\r
          "nodes": [\r
            {\r
              "id": "wrapPick_wphase",\r
              "type": "setAttribute",\r
              "params": {\r
                "name": "wphase",\r
                "domain": "point",\r
                "type": "f32",\r
                "tupleSize": 1,\r
                "value": {\r
                  "fn": "randomField",\r
                  "key": "wphase"\r
                },\r
                "values": [],\r
                "stringValue": "",\r
                "seed": 0\r
              }\r
            },\r
            {\r
              "id": "wrapPick_wturns",\r
              "type": "setAttribute",\r
              "params": {\r
                "name": "wturns",\r
                "domain": "point",\r
                "type": "f32",\r
                "tupleSize": 1,\r
                "value": {\r
                  "fn": "randomField",\r
                  "key": "wturns"\r
                },\r
                "values": [],\r
                "stringValue": "",\r
                "seed": 0\r
              }\r
            },\r
            {\r
              "id": "wrapPick_wspread",\r
              "type": "setAttribute",\r
              "params": {\r
                "name": "wspread",\r
                "domain": "point",\r
                "type": "f32",\r
                "tupleSize": 1,\r
                "value": {\r
                  "fn": "randomField",\r
                  "key": "wspread"\r
                },\r
                "values": [],\r
                "stringValue": "",\r
                "seed": 0\r
              }\r
            },\r
            {\r
              "id": "wrapOnto_wphase",\r
              "type": "transferAttribute",\r
              "params": {\r
                "name": "wphase",\r
                "mapping": "nearest",\r
                "attrDomain": "point",\r
                "uvAttr": "uv",\r
                "direction": [\r
                  0,\r
                  -1,\r
                  0\r
                ],\r
                "directionAttr": "",\r
                "maxDistance": 0,\r
                "missCountAttr": "",\r
                "hitAttr": ""\r
              }\r
            },\r
            {\r
              "id": "wrapOnto_wturns",\r
              "type": "transferAttribute",\r
              "params": {\r
                "name": "wturns",\r
                "mapping": "nearest",\r
                "attrDomain": "point",\r
                "uvAttr": "uv",\r
                "direction": [\r
                  0,\r
                  -1,\r
                  0\r
                ],\r
                "directionAttr": "",\r
                "maxDistance": 0,\r
                "missCountAttr": "",\r
                "hitAttr": ""\r
              }\r
            },\r
            {\r
              "id": "wrapOnto_wspread",\r
              "type": "transferAttribute",\r
              "params": {\r
                "name": "wspread",\r
                "mapping": "nearest",\r
                "attrDomain": "point",\r
                "uvAttr": "uv",\r
                "direction": [\r
                  0,\r
                  -1,\r
                  0\r
                ],\r
                "directionAttr": "",\r
                "maxDistance": 0,\r
                "missCountAttr": "",\r
                "hitAttr": ""\r
              }\r
            },\r
            {\r
              "id": "wrapMove",\r
              "type": "transformPoints",\r
              "params": {\r
                "translate": {\r
                  "fn": "add",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "add",\r
                              "args": [\r
                                {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        { "fn": "param", "name": "halfWidth" },\r
                                        1.4142135623730951\r
                                      ]\r
                                    },\r
                                    {\r
                                      "fn": "add",\r
                                      "args": [\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 1.1\r
                                        },\r
                                        {\r
                                          "fn": "mul",\r
                                          "args": [\r
                                            {\r
                                              "fn": "mul",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wspread",\r
                                                  "tupleSize": 1\r
                                                },\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wspread",\r
                                                  "tupleSize": 1\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 0.55\r
                                            }\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    {\r
                                      "fn": "constant",\r
                                      "value": 0.14\r
                                    },\r
                                    {\r
                                      "fn": "fbm",\r
                                      "base": "perlinNoise",\r
                                      "opts": {\r
                                        "seed": {\r
                                          "from": "node",\r
                                          "variant": 0\r
                                        },\r
                                        "frequency": 0.35,\r
                                        "offset": [\r
                                          0,\r
                                          0,\r
                                          0\r
                                        ],\r
                                        "position": {\r
                                          "fn": "position"\r
                                        },\r
                                        "octaves": 2,\r
                                        "lacunarity": 2,\r
                                        "gain": 0.5\r
                                      }\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            {\r
                              "fn": "cos",\r
                              "args": [\r
                                {\r
                                  "fn": "add",\r
                                  "args": [\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        {\r
                                          "fn": "attribute",\r
                                          "name": "wphase",\r
                                          "tupleSize": 1\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 6.283185307179586\r
                                        }\r
                                      ]\r
                                    },\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        {\r
                                          "fn": "mul",\r
                                          "args": [\r
                                            {\r
                                              "fn": "lerp",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0.4\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 3.5\r
                                                },\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wturns",\r
                                                  "tupleSize": 1\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 6.283185307179586\r
                                            }\r
                                          ]\r
                                        },\r
                                        {\r
                                          "fn": "attribute",\r
                                          "name": "curveU",\r
                                          "tupleSize": 1\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "attribute",\r
                          "name": "curveNormal",\r
                          "tupleSize": 3\r
                        }\r
                      ]\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "add",\r
                              "args": [\r
                                {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        { "fn": "param", "name": "halfWidth" },\r
                                        1.4142135623730951\r
                                      ]\r
                                    },\r
                                    {\r
                                      "fn": "add",\r
                                      "args": [\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 1.1\r
                                        },\r
                                        {\r
                                          "fn": "mul",\r
                                          "args": [\r
                                            {\r
                                              "fn": "mul",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wspread",\r
                                                  "tupleSize": 1\r
                                                },\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wspread",\r
                                                  "tupleSize": 1\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 0.55\r
                                            }\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    {\r
                                      "fn": "constant",\r
                                      "value": 0.14\r
                                    },\r
                                    {\r
                                      "fn": "fbm",\r
                                      "base": "perlinNoise",\r
                                      "opts": {\r
                                        "seed": {\r
                                          "from": "node",\r
                                          "variant": 1\r
                                        },\r
                                        "frequency": 0.35,\r
                                        "offset": [\r
                                          0,\r
                                          0,\r
                                          0\r
                                        ],\r
                                        "position": {\r
                                          "fn": "position"\r
                                        },\r
                                        "octaves": 2,\r
                                        "lacunarity": 2,\r
                                        "gain": 0.5\r
                                      }\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            {\r
                              "fn": "sin",\r
                              "args": [\r
                                {\r
                                  "fn": "add",\r
                                  "args": [\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        {\r
                                          "fn": "attribute",\r
                                          "name": "wphase",\r
                                          "tupleSize": 1\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 6.283185307179586\r
                                        }\r
                                      ]\r
                                    },\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        {\r
                                          "fn": "mul",\r
                                          "args": [\r
                                            {\r
                                              "fn": "lerp",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0.4\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 3.5\r
                                                },\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wturns",\r
                                                  "tupleSize": 1\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 6.283185307179586\r
                                            }\r
                                          ]\r
                                        },\r
                                        {\r
                                          "fn": "attribute",\r
                                          "name": "curveU",\r
                                          "tupleSize": 1\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "attribute",\r
                          "name": "curveBinormal",\r
                          "tupleSize": 3\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                "rotateEuler": [\r
                  0,\r
                  0,\r
                  0\r
                ],\r
                "scale": [\r
                  1,\r
                  1,\r
                  1\r
                ]\r
              }\r
            },\r
            {\r
              "id": "wrapSkin",\r
              "type": "sweepProfile",\r
              "params": {\r
                "profile": "circle",\r
                "sides": 8,\r
                "radius": 0.035,\r
                "frame": "upHint",\r
                "up": [\r
                  0,\r
                  1,\r
                  0\r
                ],\r
                "roll": 0,\r
                "joint": "miter",\r
                "miterLimit": 4,\r
                "caps": true\r
              }\r
            }\r
          ],\r
          "connections": [\r
            {\r
              "from": [\r
                "wrapPick_wphase",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapPick_wturns",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wturns",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapPick_wspread",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wspread",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wphase",\r
                "source"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wspread",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wturns",\r
                "source"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapOnto_wphase",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wturns",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wspread",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wspread",\r
                "source"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapOnto_wturns",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wspread",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapOnto_wspread",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapMove",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapMove",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapSkin",\r
                "in"\r
              ]\r
            }\r
          ],\r
          "outputs": []\r
        },\r
        "inputs": [\r
          {\r
            "name": "each",\r
            "node": "wrapPick_wphase",\r
            "pin": "in"\r
          },\r
          {\r
            "name": "frame",\r
            "node": "wrapOnto_wphase",\r
            "pin": "in"\r
          }\r
        ],\r
        "outputs": [\r
          {\r
            "name": "out",\r
            "node": "wrapSkin",\r
            "pin": "out"\r
          }\r
        ],\r
        "params": [\r
          {\r
            "name": "cableRadius",\r
            "targets": [\r
              {\r
                "node": "wrapSkin",\r
                "param": "radius"\r
              }\r
            ],\r
            "description": "Radius of the tube each wrap is drawn as.",\r
            "default": 0.035,\r
            "min": 0.005,\r
            "max": 0.2\r
          },\r
          {\r
            "name": "halfWidth",\r
            "targets": [],\r
            "description": "Half the truss width, passed in from the outer graph so a wrap sits on the chords it is wrapping. NO TARGETS: the body's own expression reads the name, which is the only route a value has into a body — a body is bound by its wrapper and by nothing else, so the outer graph's \`params\` block cannot reach in here.",\r
            "default": 0.425,\r
            "min": 0.15,\r
            "max": 1.2\r
          },\r
          {\r
            "name": "sides",\r
            "targets": [\r
              {\r
                "node": "wrapSkin",\r
                "param": "sides"\r
              }\r
            ],\r
            "description": "Points around the swept section of a wrap, exposed only so the outer graph's \`$tubeSides\` has something to write: an \`i32\` cannot ride into a body as an expression the way \`halfWidth\` does, so a wrapper param is the route.",\r
            "default": 8\r
          }\r
        ]\r
      }\r
    },\r
    {\r
      "id": "chainStrand",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 35,\r
        "start": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "end": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "chainStrandPath",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": false,\r
        "groupAttr": "",\r
        "orderAttr": ""\r
      }\r
    },\r
    {\r
      "id": "chainAnchors",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 7,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "chainReach",\r
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
              "fn": "constant",\r
              "value": 1\r
            },\r
            {\r
              "fn": "sub",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 13\r
                },\r
                {\r
                  "fn": "component",\r
                  "args": [\r
                    {\r
                      "fn": "position"\r
                    }\r
                  ],\r
                  "index": 1\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 1\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "chainCopies",\r
      "type": "copyToPoints",\r
      "params": {\r
        "targetNames": [],\r
        "targetIndexAttr": "",\r
        "topology": "keep"\r
      }\r
    },\r
    {\r
      "id": "chainSegments",\r
      "type": "pathSegments",\r
      "params": {\r
        "axis": "+y",\r
        "radius": 1,\r
        "extend": 0\r
      }\r
    },\r
    {\r
      "id": "chainLinkSize",\r
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
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 1.3\r
                },\r
                {\r
                  "fn": "component",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "scale",\r
                      "tupleSize": 3\r
                    }\r
                  ],\r
                  "index": 1\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 1.3\r
                },\r
                {\r
                  "fn": "component",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "scale",\r
                      "tupleSize": 3\r
                    }\r
                  ],\r
                  "index": 1\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 1.3\r
                },\r
                {\r
                  "fn": "component",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "scale",\r
                      "tupleSize": 3\r
                    }\r
                  ],\r
                  "index": 1\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "chainAlternate",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "sub",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 1\r
                },\r
                {\r
                  "fn": "sub",\r
                  "args": [\r
                    {\r
                      "fn": "index"\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 2\r
                        },\r
                        {\r
                          "fn": "floor",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
                              "args": [\r
                                {\r
                                  "fn": "index"\r
                                },\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            },\r
            {\r
              "fn": "sub",\r
              "args": [\r
                {\r
                  "fn": "index"\r
                },\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "constant",\r
                      "value": 2\r
                    },\r
                    {\r
                      "fn": "floor",\r
                      "args": [\r
                        {\r
                          "fn": "div",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "constant",\r
                              "value": 2\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "up": {\r
          "fn": "attribute",\r
          "name": "tangent",\r
          "tupleSize": 3\r
        },\r
        "axis": "+z"\r
      }\r
    },\r
    {\r
      "id": "chainSpawn",\r
      "type": "spawnInstances",\r
      "params": {\r
        "assetId": "chainLink",\r
        "assetAttr": "",\r
        "colorAttr": ""\r
      }\r
    },\r
    {\r
      "id": "danglerStrand",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 17,\r
        "start": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "end": [\r
          0,\r
          -1,\r
          0\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "danglerStrandU",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "cableU",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "fraction"\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "danglerStrandPath",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": false,\r
        "groupAttr": "",\r
        "orderAttr": ""\r
      }\r
    },\r
    {\r
      "id": "danglerAnchors",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 100,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "danglerBundling",\r
      "type": "pathPointAt",\r
      "params": {\r
        "mode": "fraction",\r
        "parameter": {\r
          "fn": "lerp",\r
          "args": [\r
            {\r
              "fn": "attribute",\r
              "name": "curveU",\r
              "tupleSize": 1\r
            },\r
            {\r
              "fn": "div",\r
              "args": [\r
                {\r
                  "fn": "add",\r
                  "args": [\r
                    {\r
                      "fn": "floor",\r
                      "args": [\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "attribute",\r
                              "name": "curveU",\r
                              "tupleSize": 1\r
                            },\r
                            {\r
                              "fn": "param",\r
                              "name": "bundles"\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    {\r
                      "fn": "constant",\r
                      "value": 0.5\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "param",\r
                  "name": "bundles"\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 0.8\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "danglerDrop",\r
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
              "fn": "constant",\r
              "value": 1\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 3.2\r
                },\r
                {\r
                  "fn": "lerp",\r
                  "args": [\r
                    {\r
                      "fn": "constant",\r
                      "value": 0.55\r
                    },\r
                    {\r
                      "fn": "constant",\r
                      "value": 1\r
                    },\r
                    {\r
                      "fn": "randomField",\r
                      "key": "drop0"\r
                    }\r
                  ]\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 1\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "danglerCopies",\r
      "type": "copyToPoints",\r
      "params": {\r
        "targetNames": [],\r
        "targetIndexAttr": "",\r
        "topology": "keep"\r
      }\r
    },\r
    {\r
      "id": "danglerCurl",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "constant",\r
                      "value": 0.5\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "attribute",\r
                          "name": "cableU",\r
                          "tupleSize": 1\r
                        },\r
                        {\r
                          "fn": "attribute",\r
                          "name": "cableU",\r
                          "tupleSize": 1\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": {\r
                      "from": "node",\r
                      "variant": {\r
                        "fn": "param",\r
                        "name": "curlVariantX",\r
                        "value": 0\r
                      }\r
                    },\r
                    "frequency": 0.5,\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "octaves": 2,\r
                    "lacunarity": 2,\r
                    "gain": 0.5,\r
                    "position": { "fn": "position" }\r
                  }\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "constant",\r
                      "value": 0.5\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "attribute",\r
                          "name": "cableU",\r
                          "tupleSize": 1\r
                        },\r
                        {\r
                          "fn": "attribute",\r
                          "name": "cableU",\r
                          "tupleSize": 1\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": {\r
                      "from": "node",\r
                      "variant": {\r
                        "fn": "param",\r
                        "name": "curlVariantZ",\r
                        "value": 1\r
                      }\r
                    },\r
                    "frequency": 0.5,\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "octaves": 2,\r
                    "lacunarity": 2,\r
                    "gain": 0.5,\r
                    "position": { "fn": "position" }\r
                  }\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "danglerDanglerSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": {\r
          "fn": "param",\r
          "name": "cableRadius"\r
        },\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    },\r
    {\r
      "id": "drapeDrapeAnchors",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 34,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "drapeChords",\r
      "type": "connectPoints",\r
      "params": {\r
        "mode": "radius",\r
        "radius": 20,\r
        "degreeAttr": "",\r
        "lengthAttr": "edgeLength"\r
      }\r
    },\r
    {\r
      "id": "drapePick",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "chordPick",\r
        "domain": "primitive",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "randomField",\r
          "key": "chord0"\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "drapeDrapeEven",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 23,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "drapeSag",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": -1\r
                },\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.45\r
                        },\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "constant",\r
                              "value": 0.36000000000000004\r
                            },\r
                            {\r
                              "fn": "fbm",\r
                              "base": "perlinNoise",\r
                              "opts": {\r
                                "seed": {\r
                                  "from": "node",\r
                                  "variant": {\r
                                    "fn": "param",\r
                                    "name": "sagVariant",\r
                                    "value": 0\r
                                  }\r
                                },\r
                                "frequency": 0.06,\r
                                "offset": [\r
                                  0,\r
                                  0,\r
                                  0\r
                                ],\r
                                "octaves": 1,\r
                                "lacunarity": 2,\r
                                "gain": 0.5,\r
                                "position": { "fn": "position" }\r
                              }\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "attribute",\r
                          "name": "edgeLength",\r
                          "tupleSize": 1\r
                        },\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "constant",\r
                              "value": 4\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "attribute",\r
                                  "name": "curveU",\r
                                  "tupleSize": 1\r
                                },\r
                                {\r
                                  "fn": "sub",\r
                                  "args": [\r
                                    {\r
                                      "fn": "constant",\r
                                      "value": 1\r
                                    },\r
                                    {\r
                                      "fn": "attribute",\r
                                      "name": "curveU",\r
                                      "tupleSize": 1\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "drapeLong",\r
      "type": "filterPrimitivesByAttribute",\r
      "params": {\r
        "attribute": "edgeLength",\r
        "comparison": "ge",\r
        "value": 4,\r
        "stringValue": "",\r
        "unreferencedPoints": "keep"\r
      }\r
    },\r
    {\r
      "id": "drapeSome",\r
      "type": "filterPrimitivesByAttribute",\r
      "params": {\r
        "attribute": "chordPick",\r
        "comparison": "lt",\r
        "value": 0.16,\r
        "stringValue": "",\r
        "unreferencedPoints": "drop"\r
      }\r
    },\r
    {\r
      "id": "drapeDrapeSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": {\r
          "fn": "param",\r
          "name": "cableRadius"\r
        },\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    }\r
  ],\r
  "connections": [\r
    {\r
      "from": [\r
        "spineLine",\r
        "out"\r
      ],\r
      "to": [\r
        "spineWander",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineWander",\r
        "out"\r
      ],\r
      "to": [\r
        "spineSpinePath",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpinePath",\r
        "out"\r
      ],\r
      "to": [\r
        "spineSpine",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCells",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussCells",\r
        "out"\r
      ],\r
      "to": [\r
        "trussFrame",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussFrame",\r
        "out"\r
      ],\r
      "to": [\r
        "trussStation",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove0",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove0",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCorners",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove2",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove2",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCorners",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove4",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove4",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCorners",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove6",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove6",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCorners",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussCorners",\r
        "out"\r
      ],\r
      "to": [\r
        "trussChordSkin",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove1",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove1",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraces",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove3",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove3",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraces",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove5",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove5",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraces",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove7",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove7",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraces",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussBraces",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraceSkin",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussCorners",\r
        "out"\r
      ],\r
      "to": [\r
        "trussPhase",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussPhase",\r
        "out"\r
      ],\r
      "to": [\r
        "trussKeep",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussKeep",\r
        "out"\r
      ],\r
      "to": [\r
        "trussRing",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussRing",\r
        "out"\r
      ],\r
      "to": [\r
        "trussFrameSkin",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "partDense",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partDense",\r
        "out"\r
      ],\r
      "to": [\r
        "partFrame",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partFrame",\r
        "out"\r
      ],\r
      "to": [\r
        "partDensity",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partDensity",\r
        "out"\r
      ],\r
      "to": [\r
        "partCluster",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partCluster",\r
        "out"\r
      ],\r
      "to": [\r
        "partScatter",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partScatter",\r
        "out"\r
      ],\r
      "to": [\r
        "partAngleAttr",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partAngleAttr",\r
        "out"\r
      ],\r
      "to": [\r
        "partMount",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partMount",\r
        "out"\r
      ],\r
      "to": [\r
        "partPart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partPart",\r
        "out"\r
      ],\r
      "to": [\r
        "partOrient",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partOrient",\r
        "out"\r
      ],\r
      "to": [\r
        "partSize",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partSize",\r
        "out"\r
      ],\r
      "to": [\r
        "partPartSpawn",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapCells",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapCells",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapFrame",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapCarrierLine",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapCarrierId",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapCarrierId",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapCarriers",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapCarriers",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapWraps",\r
        "each"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapFrame",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapWraps",\r
        "frame"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "chainAnchors",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainAnchors",\r
        "out"\r
      ],\r
      "to": [\r
        "chainReach",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainStrand",\r
        "out"\r
      ],\r
      "to": [\r
        "chainStrandPath",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainStrandPath",\r
        "out"\r
      ],\r
      "to": [\r
        "chainCopies",\r
        "source"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainReach",\r
        "out"\r
      ],\r
      "to": [\r
        "chainCopies",\r
        "target"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainCopies",\r
        "out"\r
      ],\r
      "to": [\r
        "chainSegments",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainSegments",\r
        "out"\r
      ],\r
      "to": [\r
        "chainLinkSize",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainLinkSize",\r
        "out"\r
      ],\r
      "to": [\r
        "chainAlternate",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainAlternate",\r
        "out"\r
      ],\r
      "to": [\r
        "chainSpawn",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerStrand",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerStrandU",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerAnchors",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerAnchors",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerBundling",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerBundling",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerDrop",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerStrandU",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerStrandPath",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerStrandPath",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerCopies",\r
        "source"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerDrop",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerCopies",\r
        "target"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerCopies",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerCurl",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeDrapeAnchors",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeDrapeAnchors",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeChords",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeChords",\r
        "out"\r
      ],\r
      "to": [\r
        "drapePick",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapePick",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeDrapeEven",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeDrapeEven",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeSag",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerCurl",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerDanglerSkin",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeSag",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeLong",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeLong",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeSome",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeSome",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeDrapeSkin",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "trussChordSkin",\r
      "pin": "out",\r
      "name": "truss"\r
    },\r
    {\r
      "id": "trussBraceSkin",\r
      "pin": "out",\r
      "name": "braces"\r
    },\r
    {\r
      "id": "trussFrameSkin",\r
      "pin": "out",\r
      "name": "frames"\r
    },\r
    {\r
      "id": "partPartSpawn",\r
      "pin": "instances",\r
      "name": "parts"\r
    },\r
    {\r
      "id": "wrapWraps",\r
      "pin": "out",\r
      "name": "wraps"\r
    },\r
    {\r
      "id": "chainSpawn",\r
      "pin": "instances",\r
      "name": "chains"\r
    },\r
    {\r
      "id": "danglerDanglerSkin",\r
      "pin": "out",\r
      "name": "danglers"\r
    },\r
    {\r
      "id": "drapeDrapeSkin",\r
      "pin": "out",\r
      "name": "drapes"\r
    },\r
    {\r
      "id": "spineSpine",\r
      "pin": "out",\r
      "name": "spinePoints"\r
    }\r
  ]\r
}\r
`;export{e as default};